import { redirect } from "next/navigation";
import { isPremium } from "@/utils/premium";
import { auth } from "@/app/api/auth/[...nextauth]/auth";
import prisma from "@/utils/prisma";
import { NotLoggedIn } from "@/components/ErrorDisplay";
import { env } from "@/env";

export async function redirectToWelcomeUpgrade() {
  if (!env.NEXT_PUBLIC_WELCOME_UPGRADE_ENABLED) return;

  const session = await auth();

  const email = session?.user.email;

  if (!email) return <NotLoggedIn />;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { premium: { select: { lemonSqueezyRenewsAt: true } } },
  });

  if (!user) return <NotLoggedIn />;

  if (!isPremium(user.premium?.lemonSqueezyRenewsAt || null))
    redirect("/welcome-upgrade");
}
