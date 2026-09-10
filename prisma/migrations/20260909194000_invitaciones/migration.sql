CREATE TABLE "invitaciones" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT,
  "email" TEXT,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invitaciones_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "invitaciones_token_hash_key" ON "invitaciones"("token_hash");
CREATE INDEX "invitaciones_created_by_created_at_idx" ON "invitaciones"("created_by", "created_at");
ALTER TABLE "invitaciones" ADD CONSTRAINT "invitaciones_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invitaciones" ADD CONSTRAINT "invitaciones_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
