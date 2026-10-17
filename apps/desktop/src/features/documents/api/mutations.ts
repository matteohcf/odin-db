import {
  type ConnectionId,
  commands,
  type EJsonDocument,
  type EJsonValue,
  type ExplainRequest,
  type Namespace,
} from "@odin-db/bindings";
import { useMutation } from "@tanstack/react-query";
import { call } from "@/lib/ipc";

interface Target {
  connectionId: ConnectionId;
  namespace: Namespace;
}

export function useInsertDocument() {
  return useMutation({
    mutationFn: ({ connectionId, namespace, document }: Target & { document: EJsonDocument }) =>
      call(commands.insertDocument(connectionId, namespace, document)),
    meta: { handlesErrors: true },
  });
}

export function useReplaceDocument() {
  return useMutation({
    mutationFn: ({
      connectionId,
      namespace,
      id,
      document,
    }: Target & { id: EJsonValue; document: EJsonDocument }) =>
      call(commands.replaceDocument(connectionId, namespace, id, document)),
    meta: { handlesErrors: true },
  });
}

export function useDeleteDocument() {
  return useMutation({
    mutationFn: ({ connectionId, namespace, id }: Target & { id: EJsonValue }) =>
      call(commands.deleteDocument(connectionId, namespace, id)),
  });
}

export function useCountDocuments() {
  return useMutation({
    mutationFn: ({ connectionId, namespace, filter }: Target & { filter: EJsonDocument }) =>
      call(commands.countDocuments(connectionId, namespace, filter)),
  });
}

export function useExplainFind() {
  return useMutation({
    mutationFn: ({ connectionId, namespace, request }: Target & { request: ExplainRequest }) =>
      call(commands.explainFind(connectionId, namespace, request)),
    meta: { handlesErrors: true },
  });
}

export function useSetDocumentField() {
  return useMutation({
    mutationFn: ({
      connectionId,
      namespace,
      id,
      field,
      value,
    }: Target & { id: EJsonValue; field: string; value: EJsonValue | null }) =>
      call(commands.setDocumentField(connectionId, namespace, id, field, value)),
    meta: { handlesErrors: true },
  });
}
