import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);

// Public decision endpoint for links embedded in admin notification emails.
// GET /decision?rental=<id>&approve=1|0&token=<ADMIN_ACTION_TOKEN>
const decision = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const rental = url.searchParams.get("rental");
  const approve = url.searchParams.get("approve");
  const token = url.searchParams.get("token");
  if (!rental || approve === null) {
    return new Response("Missing parameters", { status: 400 });
  }
  if (!token || token !== process.env.ADMIN_ACTION_TOKEN) {
    return new Response("Invalid token", { status: 403 });
  }
  const isTrue = approve === "1" || approve === "true";
  await ctx.runMutation(api.parts.decideRental, {
    rentalId: rental as any,
    approve: isTrue,
    token,
  });
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>Decision recorded</title></head>
     <body style="font-family:sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#0a0a0a;color:#fafafa">
       <div style="text-align:center">
         <h1 style="font-size:20px">✓ Request ${isTrue ? "approved" : "denied"}</h1>
         <p style="color:#a1a1aa">You can close this window. The student has been updated in the dashboard.</p>
       </div>
     </body></html>`,
    { status: 200, headers: { "content-type": "text/html" } },
  );
});

http.route({
  path: "/decision",
  method: "GET",
  handler: decision,
});

export default http;
