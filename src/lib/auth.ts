import NextAuth, {
  type DefaultSession,
  type NextAuthConfig,
} from "next-auth";
import Credentials from "next-auth/providers/credentials";

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

export const authConfig = {
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Contraseña", type: "password" },
      },
      async authorize(credentials) {
        const email =
          typeof credentials.email === "string"
            ? credentials.email.trim().toLowerCase()
            : "";
        const password =
          typeof credentials.password === "string" ? credentials.password : "";

        if (!email || !password) return null;

        const [{ db }, { compare }] = await Promise.all([
          import("@/lib/db"),
          import("bcryptjs"),
        ]);

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

        if (!user) return null;

        const passwordOk = await compare(password, user.hashedPassword);
        if (!passwordOk) return null;

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
