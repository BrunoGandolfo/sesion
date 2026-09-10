import { RestablecerForm } from "./restablecer-form";
export default async function RestablecerPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return <RestablecerForm token={typeof token === "string" ? token : ""} />;
}
