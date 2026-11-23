import { withApi } from "@/server/http/handler";
import { notFound } from "@/server/http/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Unknown /api/v1/* paths get the standard JSON error envelope instead of the HTML 404 page. */
const handler = withApi(() => {
  throw notFound("This API endpoint does not exist.");
});

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
