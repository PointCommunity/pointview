import { serverConfig } from "@/server/config";
import { sqlClient } from "@/server/db/client";
import { GitHubAppClient } from "@/server/github/client";
import { GitHubMutationAdapter } from "@/server/github/mutation-port";
import { checkReadiness } from "@/server/operations/readiness";
import { FileAttachmentStore } from "@/server/storage/file-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = serverConfig();
  const result = await checkReadiness(sqlClient(), {
    storage: new FileAttachmentStore(config.attachmentRoot),
    github: async (source) => {
      const client = new GitHubAppClient({
        appId: config.github.appId, installationId: source.installationId, privateKeyPem: config.github.privateKey,
        allowedRepositories: new Set([`${source.owner}/${source.repo}`]),
      });
      const readback = await new GitHubMutationAdapter(client, source.owner, source.repo, source.projectNodeId, source.projectNumber).readMutationPreconditions();
      if (readback.nodeId !== source.projectNodeId || readback.number !== source.projectNumber || readback.public) throw new Error("GitHub source target mismatch");
    },
  });
  return Response.json(result, { status: result.ready ? 200 : 503, headers: { "cache-control": "no-store" } });
}
