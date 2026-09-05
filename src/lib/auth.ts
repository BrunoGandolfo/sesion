import NextAuth, {
  type DefaultSession,
  type NextAuthConfig,
} from "next-auth";
import Credentials from "next-auth/providers/credentials";

// Módulo puro (sólo constantes y una validación de strings): se puede
// importar estático aunque este archivo lo cargue el middleware, que corre
// en el runtime edge.
import { BCRYPT_RONDAS } from "@/lib/password";

declare module "next-auth" {
  interface Session {
    userId: string;
    organizationId: string;
    user: {
      id: string;
      organizationId: string;
    } & DefaultSession["user"];
  }

  interface User {
    organizationId: string;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    userId?: string;
    organizationId?: string;
  }
}

/**
 * Hash señuelo contra el que comparar cuando el email no existe, para que un
 * email desconocido tarde lo mismo que uno real. No es un secreto —da igual
 * qué contraseña codifica— y se calcula una sola vez por instancia, recién
 * cuando hace falta: bcrypt con BCRYPT_RONDAS cuesta decenas de milisegundos
 * y no tiene sentido pagarlos en cada arranque en frío.
 */
let senueloPendiente: Promise<string> | null = null;

function hashSenuelo(crear: () => Promise<string>): Promise<string> {
  senueloPendiente ??= crear();
  return senueloPendiente;
}

export const authConfig = {
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Contraseña", type: "password" },
      },
      // `request` viene del provider de credenciales: de ahí salen la IP y el
      // user-agent que van al registro y que alimentan el límite por IP.
      //
      // Todo lo pesado (Prisma, bcrypt, node:crypto) entra por import
      // dinámico, como ya hacía bcryptjs: este archivo lo importa el
      // middleware, que corre en el runtime edge, y ahí esos módulos no
      // existen. authorize() nunca se ejecuta en el middleware.
      async authorize(credentials, request) {
        const email =
          typeof credentials.email === "string"
            ? credentials.email.trim().toLowerCase()
            : "";
        const password =
          typeof credentials.password === "string" ? credentials.password : "";

        if (!email || !password) return null;

        const [{ dbAuth: db }, { compare, hash }, login] = await Promise.all([
          import("@/lib/db-auth"),
          import("bcryptjs"),
          import("@/lib/login-eventos"),
        ]);

        const ahora = new Date();
        const { ip, userAgent } = login.huellaDeRequest(request);
        const intento = { email, ip, userAgent, ahora };

        // Demasiados fallos recientes: se corta acá y NO se registra nada.
        // Si cada intento bloqueado contara como fallo, quien golpea la
        // puerta podría dejar afuera a la profesional para siempre, y la
        // tabla crecería sin techo.
        const bloqueo = await login.evaluarIntento(intento);
        if (bloqueo.bloqueado) return null;

        const user = await db.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            hashedPassword: true,
            nombre: true,
            organizationId: true,
          },
        });

        // El compare se hace exista o no el usuario. Con el `return null`
        // temprano de antes, un email inexistente contestaba en un
        // milisegundo y uno real tardaba lo que tarda bcrypt: el reloj
        // decía qué emails están dados de alta aunque el mensaje no lo
        // dijera.
        const contra = user
          ? user.hashedPassword
          : await hashSenuelo(() =>
              hash("señuelo-de-tiempo-constante", BCRYPT_RONDAS),
            );
        const passwordOk = await compare(password, contra);

        if (!user || !passwordOk) {
          await login.registrarLoginFallido({
            ...intento,
            organizationId: user?.organizationId ?? null,
            motivo: user ? "password" : "email",
            bloqueoPrevio: bloqueo,
          });
          return null;
        }

        await login.registrarLoginOk({
          ...intento,
          userId: user.id,
          organizationId: user.organizationId,
        });

        return {
          id: user.id,
          email: user.email,
          name: user.nombre,
          organizationId: user.organizationId,
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.organizationId = user.organizationId;
      }

      return token;
    },
    session({ session, token }) {
      const userId = token.userId;
      const organizationId = token.organizationId;

      if (userId) {
        session.userId = userId;
        session.user = {
          ...session.user,
          id: userId,
          organizationId: organizationId ?? "",
        };
      }

      if (organizationId) {
        session.organizationId = organizationId;
        session.user = {
          ...session.user,
          id: session.user.id,
          organizationId,
        };
      }

      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

// Para crear el usuario de Mariana en la DB:
// npx prisma db seed (o ejecutar manualmente):
// INSERT: email "mariana@consultorio.uy", password hasheada con bcrypt (10 rounds)
// organizationId: el id de la organización creada
