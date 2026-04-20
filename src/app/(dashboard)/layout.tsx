import { Sidebar } from "@/components/layout/sidebar";
import { BottomNav } from "@/components/layout/bottom-nav";
import { Providers } from "@/components/layout/providers";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Providers>
      <div className="flex h-screen overflow-hidden bg-cream-50">
        <Sidebar />
        <main className="flex-1 overflow-y-auto pb-20 lg:pb-0">
          {children}
        </main>
        <BottomNav />
      </div>
    </Providers>
  );
}
