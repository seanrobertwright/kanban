import { redirect } from "next/navigation";

import { SignInCard } from "@/features/auth/components/sign-in-card";
import { getSession } from "@/features/auth/server/session";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const session = await getSession();
  if (session) redirect("/");

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <SignInCard />
    </main>
  );
}
