"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { useForm } from "react-hook-form";
import useSWR from "swr";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import {
  saveRulesPromptAction,
  generateRulesPromptAction,
} from "@/utils/actions/ai-rule";
import { isActionError } from "@/utils/error";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/Input";
import {
  saveRulesPromptBody,
  type SaveRulesPromptBody,
} from "@/utils/actions/validation";
import { SectionHeader } from "@/components/Typography";
import type { RulesPromptResponse } from "@/app/api/user/rules/prompt/route";
import { LoadingContent } from "@/components/LoadingContent";

const examplePrompts = [
  'Label newsletters as "Newsletter" and archive them',
  'Label marketing emails as "Marketing" and archive them',
  'Label emails that require a reply as "Reply Required"',
  'Label urgent emails as "Urgent"',
  'Label receipts as "Receipt" and forward them to jane@accounting.com',
  'Label pitch decks as "Pitch Deck" and forward them to john@investing.com',
  "Reply to cold emails by telling them to check out Inbox Zero. Then mark them as spam",
  'Label high priority emails as "High Priority"',
  "If a founder asks to set up a call, send them my Cal link: https://cal.com/max",
  "If someone asks to cancel a plan, ask to set up a call by sending my Cal link",
  'If a founder sends me an investor update, label it "Investor Update" and archive it',
  'If someone pitches me their startup, label it as "Investing", archive it, and respond with a friendly reply that I no longer have time to look at the email but if they get a warm intro, that\'s their best bet to get funding from me',
  "If someone asks for a discount, reply with the discount code INBOX20",
  "If someone asks for help with MakerPad, tell them I no longer work there, but they should reach out to the Zapier team for support",
  "Review any emails from questions@pr.com and see if any are about finance. If so, draft a friendly reply that answers the question",
  'If people ask me to speak at an event, label the email "Speaker Opportunity" and archive it',
  'Label customer emails as "Customer"',
  'Label legal documents as "Legal"',
  'Label server errors as "Error"',
  'Label Stripe emails as "Stripe"',
];

export function RulesPrompt() {
  const { data, isLoading, error, mutate } = useSWR<
    RulesPromptResponse,
    { error: string }
  >(`/api/user/rules/prompt`);

  return (
    <LoadingContent loading={isLoading} error={error}>
      <RulesPromptForm
        rulesPrompt={data?.rulesPrompt || undefined}
        mutate={mutate}
      />
    </LoadingContent>
  );
}

function RulesPromptForm({
  rulesPrompt,
  mutate,
}: {
  rulesPrompt?: string;
  mutate: () => void;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
    getValues,
    setValue,
  } = useForm<SaveRulesPromptBody>({
    resolver: zodResolver(saveRulesPromptBody),
    defaultValues: { rulesPrompt },
  });
  const router = useRouter();

  const onSubmit = useCallback(
    async (data: SaveRulesPromptBody) => {
      setIsSubmitting(true);

      const saveRulesPromise = async (data: SaveRulesPromptBody) => {
        const result = await saveRulesPromptAction(data);
        if (isActionError(result)) {
          throw new Error(result.error);
        }
        return result;
      };

      toast.promise(() => saveRulesPromise(data), {
        loading: "Saving rules... This may take a while to process...",
        success: (result) => {
          const { createdRules, editedRules, removedRules } = result || {};

          router.push("/automation?tab=rules");
          mutate();
          setIsSubmitting(false);

          return `Rules saved successfully! ${[
            createdRules ? `${createdRules} rules created. ` : "",
            editedRules ? `${editedRules} rules edited. ` : "",
            removedRules ? `${removedRules} rules removed. ` : "",
          ].join("")}`;
        },
        error: (err) => {
          setIsSubmitting(false);
          return `Error saving rules: ${err.message}`;
        },
      });
    },
    [router, mutate],
  );

  const addExamplePrompt = useCallback(
    (example: string) => {
      setValue(
        "rulesPrompt",
        `${getValues("rulesPrompt")}\n* ${example.trim()}`.trim(),
      );
    },
    [setValue, getValues],
  );

  return (
    <Card className="grid grid-cols-1 sm:grid-cols-3">
      <div className="sm:col-span-2">
        <CardHeader>
          <CardTitle>
            How your AI personal assistant should handle your emails
          </CardTitle>
          <CardDescription>
            Write a prompt for your assistant to follow.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)}>
            <div className="space-y-4 sm:col-span-2">
              <Input
                className="min-h-[300px]"
                registerProps={register("rulesPrompt", { required: true })}
                name="rulesPrompt"
                type="text"
                as="textarea"
                rows={25}
                error={errors.rulesPrompt}
                placeholder={`Here's an example of what your prompt might look like.
You can use the examples on the right or come up with your own.
Feel free to add as many as you want:

* Label and archive newsletters as "Newsletter".
* Archive all marketing emails.
* Label receipts as "Receipt" and forward them to jane@accounting.com.
* Label emails that require a reply as "Reply Required".
* If a customer asks to set up a call, send them my Cal link: https://cal.com/max
* Review any emails from questions@pr.com and see if any are about finance. If so, respond with a friendly draft a reply that answers the question.
            `}
              />

              <div className="flex gap-2">
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  loading={isSubmitting}
                >
                  Save
                </Button>

                <Button type="button" variant="outline" asChild>
                  <Link href="/automation/create">Create Rules Manually</Link>
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    toast.promise(
                      async () => {
                        setIsGenerating(true);
                        const result = await generateRulesPromptAction();
                        setIsGenerating(false);
                        if (isActionError(result))
                          throw new Error(result.error);
                        if (!result)
                          throw new Error("Unable to generate prompt");
                        return result;
                      },
                      {
                        loading: "Generating prompt...",
                        success: (result) => {
                          setValue("rulesPrompt", result.rulesPrompt);
                          return "Prompt generated successfully!";
                        },
                        error: (err) => {
                          return `Error generating prompt: ${err.message}`;
                        },
                      },
                    );
                  }}
                  loading={isGenerating}
                >
                  AI Generate Prompt
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      </div>
      <div className="px-6 sm:mt-8 sm:p-0">
        <SectionHeader>Examples</SectionHeader>

        <ScrollArea className="mt-2 sm:h-[600px] sm:max-h-[600px]">
          <div className="grid grid-cols-1 gap-2 sm:pr-3">
            {examplePrompts.map((example) => (
              <Button
                key={example}
                variant="outline"
                onClick={() => addExamplePrompt(example)}
                className="h-auto w-full justify-start text-wrap py-2 text-left"
              >
                {example}
              </Button>
            ))}
          </div>
        </ScrollArea>
      </div>
    </Card>
  );
}
