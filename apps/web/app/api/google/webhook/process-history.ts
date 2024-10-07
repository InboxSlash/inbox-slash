import uniqBy from "lodash/uniqBy";
import { NextResponse } from "next/server";
import type { gmail_v1 } from "@googleapis/gmail";
import { getGmailClientWithRefresh } from "@/utils/gmail/client";
import prisma from "@/utils/prisma";
import { emailToContent, parseMessage } from "@/utils/mail";
import {
  DRAFT_LABEL_ID,
  INBOX_LABEL_ID,
  SENT_LABEL_ID,
} from "@/utils/gmail/label";
import type { RuleWithActions } from "@/utils/types";
import { getMessage, hasPreviousEmailsFromDomain } from "@/utils/gmail/message";
import { getThread } from "@/utils/gmail/thread";
import type { UserAIFields } from "@/utils/llms/types";
import { hasAiAccess, hasColdEmailAccess, isPremium } from "@/utils/premium";
import { ColdEmailSetting, type User } from "@prisma/client";
import { runColdEmailBlocker } from "@/app/api/ai/cold-email/controller";
import { captureException } from "@/utils/error";
import { runRulesOnMessage } from "@/utils/ai/choose-rule/run-rules";
import { blockUnsubscribedEmails } from "@/app/api/google/webhook/block-unsubscribed-emails";

export async function processHistoryForUser(
  decodedData: {
    emailAddress: string;
    historyId: number;
  },
  options?: { startHistoryId?: string },
) {
  const { emailAddress: email, historyId } = decodedData;

  const account = await prisma.account.findFirst({
    where: { user: { email }, provider: "google" },
    select: {
      access_token: true,
      refresh_token: true,
      expires_at: true,
      providerAccountId: true,
      userId: true,
      user: {
        select: {
          email: true,
          about: true,
          lastSyncedHistoryId: true,
          rules: {
            where: { enabled: true },
            include: { actions: true },
          },
          coldEmailBlocker: true,
          coldEmailPrompt: true,
          aiProvider: true,
          aiModel: true,
          aiApiKey: true,
          premium: {
            select: {
              lemonSqueezyRenewsAt: true,
              coldEmailBlockerAccess: true,
              aiAutomationAccess: true,
            },
          },
        },
      },
    },
  });

  if (!account) {
    console.error(`Google webhook: Account not found. email: ${email}`);
    return NextResponse.json({ ok: true });
  }

  const premium = isPremium(account.user.premium?.lemonSqueezyRenewsAt || null)
    ? account.user.premium
    : undefined;

  if (!premium) {
    console.log(`Google webhook: Account not premium. email: ${email}`);
    return NextResponse.json({ ok: true });
  }

  const userHasAiAccess = hasAiAccess(
    premium.aiAutomationAccess,
    account.user.aiApiKey,
  );
  const userHasColdEmailAccess = hasColdEmailAccess(
    premium.coldEmailBlockerAccess,
    account.user.aiApiKey,
  );

  if (!userHasAiAccess && !userHasColdEmailAccess) {
    console.debug(
      `Google webhook: does not have hasAiOrColdEmailAccess. email: ${email}`,
    );
    return NextResponse.json({ ok: true });
  }

  const hasAutomationRules = account.user.rules.length > 0;
  const shouldBlockColdEmails =
    account.user.coldEmailBlocker &&
    account.user.coldEmailBlocker !== ColdEmailSetting.DISABLED;
  if (!hasAutomationRules && !shouldBlockColdEmails) {
    console.debug(
      `Google webhook: has no rules set and cold email blocker disabled. email: ${email}`,
    );
    return NextResponse.json({ ok: true });
  }

  if (!account.access_token || !account.refresh_token) {
    console.error(
      `Missing access or refresh token. User needs to re-authenticate. email: ${email}`,
    );
    return NextResponse.json({ ok: true });
  }

  if (!account.user.email) {
    // shouldn't ever happen
    console.error("Missing user email.", email);
    return NextResponse.json({ ok: true });
  }

  try {
    const gmail = await getGmailClientWithRefresh(
      {
        accessToken: account.access_token,
        refreshToken: account.refresh_token,
        expiryDate: account.expires_at,
      },
      account.providerAccountId,
    );

    const startHistoryId =
      options?.startHistoryId ||
      Math.max(
        Number.parseInt(account.user.lastSyncedHistoryId || "0"),
        historyId - 500, // avoid going too far back
      ).toString();

    console.log(
      `Webhook: Listing history... Start: ${startHistoryId} lastSyncedHistoryId: ${account.user.lastSyncedHistoryId} gmailHistoryId: ${startHistoryId} email: ${email}`,
    );

    const history = await gmail.users.history.list({
      userId: "me",
      // NOTE this can cause problems if we're way behind
      // NOTE this doesn't include startHistoryId in the results
      startHistoryId,
      labelId: INBOX_LABEL_ID,
      historyTypes: ["messageAdded", "labelAdded"],
      maxResults: 500,
    });

    if (history.data.history) {
      console.log(
        `Webhook: Processing... email: ${email} startHistoryId: ${startHistoryId} historyId: ${history.data.historyId}`,
      );

      await processHistory({
        history: history.data.history,
        email,
        gmail,
        hasAutomationRules,
        rules: account.user.rules,
        hasColdEmailAccess: userHasColdEmailAccess,
        hasAiAutomationAccess: userHasAiAccess,
        user: {
          id: account.userId,
          email: account.user.email,
          about: account.user.about || "",
          aiProvider: account.user.aiProvider,
          aiModel: account.user.aiModel,
          aiApiKey: account.user.aiApiKey,
          coldEmailPrompt: account.user.coldEmailPrompt,
          coldEmailBlocker: account.user.coldEmailBlocker,
        },
      });
    } else {
      console.log(
        `Webhook: No history. startHistoryId: ${startHistoryId}. ${JSON.stringify(decodedData)}`,
      );

      // important to save this or we can get into a loop with never receiving history
      await prisma.user.update({
        where: { email: account.user.email },
        data: { lastSyncedHistoryId: historyId.toString() },
      });
    }

    console.log(`Webhook: Completed. ${JSON.stringify(decodedData)}`);

    return NextResponse.json({ ok: true });
  } catch (error) {
    captureException(error, { extra: { decodedData } }, email);
    console.error("Error processing webhook", error, decodedData);
    return NextResponse.json({ error: true });
    // be careful about calling an error here with the wrong settings, as otherwise PubSub will call the webhook over and over
    // return NextResponse.error();
  }
}

type ProcessHistoryOptions = {
  history: gmail_v1.Schema$History[];
  email: string;
  gmail: gmail_v1.Gmail;
  rules: RuleWithActions[];
  hasAutomationRules: boolean;
  hasColdEmailAccess: boolean;
  hasAiAutomationAccess: boolean;
  user: Pick<
    User,
    "id" | "email" | "about" | "coldEmailPrompt" | "coldEmailBlocker"
  > &
    UserAIFields;
};

async function processHistory(options: ProcessHistoryOptions) {
  const { history, email } = options;

  if (!history?.length) return;

  for (const h of history) {
    const historyMessages = [
      ...(h.messagesAdded || []),
      ...(h.labelsAdded || []),
    ];

    if (!historyMessages.length) continue;

    const inboxMessages = historyMessages.filter(
      (m) =>
        m.message?.labelIds?.includes(INBOX_LABEL_ID) &&
        !m.message?.labelIds?.includes(DRAFT_LABEL_ID) &&
        !m.message?.labelIds?.includes(SENT_LABEL_ID),
    );
    const uniqueMessages = uniqBy(inboxMessages, (m) => m.message?.id);

    for (const m of uniqueMessages) {
      try {
        await processHistoryItem(m, options);
      } catch (error) {
        captureException(
          error,
          { extra: { email, messageId: m.message?.id } },
          email,
        );
        console.error(`Error processing history item. email: ${email}`, error);
      }
    }
  }

  const lastSyncedHistoryId = history[history.length - 1].id;

  await prisma.user.update({
    where: { email },
    data: { lastSyncedHistoryId },
  });
}

async function processHistoryItem(
  m: gmail_v1.Schema$HistoryMessageAdded | gmail_v1.Schema$HistoryLabelAdded,
  {
    gmail,
    user,
    hasColdEmailAccess,
    hasAutomationRules,
    hasAiAutomationAccess,
    rules,
  }: ProcessHistoryOptions,
) {
  const message = m.message;
  const messageId = message?.id;
  const threadId = message?.threadId;

  if (!messageId) return;
  if (!threadId) return;

  console.log(
    `Getting message... email: ${user.email} messageId: ${messageId} threadId: ${threadId}`,
  );

  try {
    const [gmailMessage, gmailThread, hasExistingRule] = await Promise.all([
      getMessage(messageId, gmail, "full"),
      getThread(threadId, gmail),
      prisma.executedRule.findUnique({
        where: {
          unique_user_thread_message: { userId: user.id, threadId, messageId },
        },
        select: { id: true },
      }),
    ]);

    const message = parseMessage(gmailMessage);

    const blocked = await blockUnsubscribedEmails({
      from: message.headers.from,
      userId: user.id,
      gmail,
      messageId,
    });

    if (blocked) {
      console.log(
        `Skipping. Blocked unsubscribed email. email: ${user.email} messageId: ${messageId} threadId: ${threadId}`,
      );
      return;
    }

    if (hasExistingRule) {
      console.log("Skipping. Rule already exists.");
      return;
    }

    const isThread = !!gmailThread.messages && gmailThread.messages.length > 1;

    if (hasAutomationRules && hasAiAutomationAccess) {
      await runRulesOnMessage({
        gmail,
        message,
        rules,
        user,
        isThread,
      });
    }

    const shouldRunBlocker = shouldRunColdEmailBlocker(
      user.coldEmailBlocker,
      hasColdEmailAccess,
      isThread,
    );

    if (shouldRunBlocker) {
      const hasPreviousEmail = await hasPreviousEmailsFromDomain(gmail, {
        from: message.headers.from,
        date: message.headers.date,
        threadId,
      });

      const content = emailToContent({
        textHtml: message.textHtml || null,
        textPlain: message.textPlain || null,
        snippet: message.snippet,
      });

      await runColdEmailBlocker({
        hasPreviousEmail,
        email: {
          from: message.headers.from,
          subject: message.headers.subject,
          content,
          messageId,
          threadId,
        },
        gmail,
        user,
      });
    }
  } catch (error: any) {
    // gmail bug or snoozed email: https://stackoverflow.com/questions/65290987/gmail-api-getmessage-method-returns-404-for-message-gotten-from-listhistory-meth
    if (error.message === "Requested entity was not found.") {
      console.log(
        `Message not found. email: ${user.email} messageId: ${messageId} threadId: ${threadId}`,
      );
      return;
    }

    throw error;
  }
}

function shouldRunColdEmailBlocker(
  coldEmailBlocker: ColdEmailSetting | null,
  hasColdEmailAccess: boolean,
  isThread: boolean,
) {
  return (
    coldEmailBlocker &&
    coldEmailBlocker !== ColdEmailSetting.DISABLED &&
    hasColdEmailAccess &&
    !isThread
  );
}
