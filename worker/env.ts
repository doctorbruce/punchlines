import type { SessionUser } from "../shared/types";

export interface AppEnv {
  Bindings: { DB: D1Database; IMAGES: R2Bucket };
  Variables: { user: SessionUser; sessionHash: string };
}
