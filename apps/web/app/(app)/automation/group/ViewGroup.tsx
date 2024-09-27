"use client";

import useSWR, { type KeyedMutator } from "swr";
import { PlusIcon, SparklesIcon, TrashIcon } from "lucide-react";
import { useState, useCallback } from "react";
import { type SubmitHandler, useForm } from "react-hook-form";
import { toastSuccess, toastError } from "@/components/Toast";
import type { GroupItemsResponse } from "@/app/api/user/group/[groupId]/items/route";
import { LoadingContent } from "@/components/LoadingContent";
import { Modal, useModal } from "@/components/Modal";
import { Button } from "@/components/ui/button";
import { ButtonLoader } from "@/components/Loading";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { MessageText } from "@/components/Typography";
import {
  addGroupItemAction,
  deleteGroupAction,
  deleteGroupItemAction,
  regenerateNewsletterGroupAction,
  regenerateReceiptGroupAction,
} from "@/utils/actions/group";
import { GroupName } from "@/utils/config";
import { GroupItemType } from "@prisma/client";
import { Input } from "@/components/Input";
import { Select } from "@/components/Select";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  type AddGroupItemBody,
  addGroupItemBody,
} from "@/utils/actions/validation";
import { isActionError } from "@/utils/error";
import { Badge } from "@/components/ui/badge";
import { capitalCase } from "capital-case";

export function ViewGroupButton({
  groupId,
  name,
  ButtonComponent,
}: {
  groupId: string;
  name: string;
  ButtonComponent?: React.ComponentType<{ onClick: () => void }>;
}) {
  const { isModalOpen, openModal, closeModal } = useModal();

  return (
    <>
      {ButtonComponent ? (
        <ButtonComponent onClick={openModal} />
      ) : (
        <Button size="sm" variant="outline" onClick={openModal}>
          Edit
        </Button>
      )}
      <Modal
        isOpen={isModalOpen}
        hideModal={closeModal}
        title={name}
        size="4xl"
      >
        <div className="mt-4">
          <ViewGroup groupId={groupId} groupName={name} onDelete={closeModal} />
        </div>
      </Modal>
    </>
  );
}

function ViewGroup({
  groupId,
  groupName,
  onDelete,
}: {
  groupId: string;
  groupName: string;
  onDelete: () => void;
}) {
  const { data, isLoading, error, mutate } = useSWR<GroupItemsResponse>(
    `/api/user/group/${groupId}/items`,
  );

  const [showAddItem, setShowAddItem] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  return (
    <div>
      <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center sm:justify-end">
        {showAddItem ? (
          <AddGroupItemForm groupId={groupId} mutate={mutate} />
        ) : (
          <>
            <Button variant="outline" onClick={() => setShowAddItem(true)}>
              <PlusIcon className="mr-2 h-4 w-4" />
              Add Item
            </Button>
            {(groupName === GroupName.NEWSLETTER ||
              groupName === GroupName.RECEIPT) && (
              <Button
                variant="outline"
                disabled={isRegenerating}
                onClick={async () => {
                  setIsRegenerating(true);
                  const result =
                    groupName === GroupName.NEWSLETTER
                      ? await regenerateNewsletterGroupAction(groupId)
                      : groupName === GroupName.RECEIPT
                        ? await regenerateReceiptGroupAction(groupId)
                        : null;

                  if (isActionError(result)) {
                    toastError({
                      description: `Failed to regenerate group. ${result.error}`,
                    });
                  } else {
                    toastSuccess({ description: `Group items regenerated!` });
                  }
                  setIsRegenerating(false);
                }}
              >
                {isRegenerating ? (
                  <ButtonLoader />
                ) : (
                  <SparklesIcon className="mr-2 h-4 w-4" />
                )}
                Regenerate Group
              </Button>
            )}
            <Button
              variant="outline"
              disabled={isDeleting}
              onClick={async () => {
                const yes = confirm(
                  "Are you sure you want to delete this group?",
                );

                if (!yes) return;

                setIsDeleting(true);

                const result = await deleteGroupAction(groupId);
                if (isActionError(result)) {
                  toastError({
                    description: `Failed to delete group. ${result.error}`,
                  });
                } else {
                  onDelete();
                }
                mutate();
                setIsDeleting(false);
              }}
            >
              {isDeleting ? (
                <ButtonLoader />
              ) : (
                <TrashIcon className="mr-2 h-4 w-4" />
              )}
              Delete Group
            </Button>
          </>
        )}
      </div>

      <div className="mt-4">
        <LoadingContent
          loading={!data && isLoading}
          error={error}
          loadingComponent={<Skeleton className="h-24 rounded" />}
        >
          {data && (
            <>
              {data.items.length ? (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Sender</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data?.items.map((item) => {
                        // within last 2 minutes
                        const isRecent =
                          new Date(item.createdAt) >
                          new Date(Date.now() - 1000 * 60 * 2);

                        return (
                          <TableRow key={item.id}>
                            <TableCell>
                              {isRecent && (
                                <Badge variant="green" className="mr-2">
                                  New!
                                </Badge>
                              )}

                              <Badge variant="secondary" className="mr-2">
                                {capitalCase(item.type)}
                              </Badge>
                              {item.value}
                            </TableCell>
                            <TableCell className="py-2">
                              <Button
                                variant="outline"
                                size="icon"
                                onClick={async () => {
                                  const result = await deleteGroupItemAction(
                                    item.id,
                                  );
                                  if (isActionError(result)) {
                                    toastError({
                                      description: `Failed to remove ${item.value} from group. ${result.error}`,
                                    });
                                  } else {
                                    mutate();
                                  }
                                }}
                              >
                                <TrashIcon className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </>
              ) : (
                <MessageText className="mt-4">
                  There are no senders in this group.
                </MessageText>
              )}
            </>
          )}
        </LoadingContent>
      </div>
    </div>
  );
}

const AddGroupItemForm = ({
  groupId,
  mutate,
}: {
  groupId: string;
  mutate: KeyedMutator<GroupItemsResponse>;
}) => {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AddGroupItemBody>({
    resolver: zodResolver(addGroupItemBody),
    defaultValues: { groupId },
  });

  const onSubmit: SubmitHandler<AddGroupItemBody> = useCallback(
    async (data) => {
      const result = await addGroupItemAction(data);
      if (isActionError(result)) {
        toastError({
          description: `Failed to add ${data.value} to ${data.groupId}. ${result.error}`,
        });
      } else {
        toastSuccess({ description: `Item added to group!` });
      }
      mutate();
    },
    [mutate],
  );

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="grid grid-cols-1 gap-2 sm:flex sm:items-center"
    >
      <Select
        name="type"
        label=""
        options={[
          { label: "From", value: GroupItemType.FROM },
          { label: "Subject", value: GroupItemType.SUBJECT },
        ]}
        registerProps={register("type", { required: true })}
        error={errors.type}
      />
      <Input
        type="text"
        name="value"
        placeholder="eg. elie@getinboxzero.com"
        registerProps={register("value", { required: true })}
        error={errors.value}
        className="min-w-[250px]"
      />
      <Button type="submit" variant="outline" loading={isSubmitting}>
        Add
      </Button>
    </form>
  );
};
