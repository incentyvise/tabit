import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { Persister } from "@tanstack/react-query-persist-client";
import { createStore, del, get, set } from "idb-keyval";

const idbStore =
  typeof window !== "undefined"
    ? createStore("tabit-query-cache", "queries")
    : null;

export const persister: Persister = idbStore
  ? createAsyncStoragePersister({
      storage: {
        getItem: async (key) => await get(key, idbStore),
        setItem: async (key, value) => await set(key, value, idbStore),
        removeItem: async (key) => await del(key, idbStore),
      },
    })
  : {
      persistClient: async () => {},
      restoreClient: async () => undefined,
      removeClient: async () => {},
    };
