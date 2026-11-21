import { randomUUID } from "node:crypto";
import { RoomAgentDispatch, RoomConfiguration } from "@livekit/protocol";
import { AccessToken } from "livekit-server-sdk";

/** Participant attribute naming the recipient a browser test call is for. Set only by the API's token. */
export const TEST_CALL_RECIPIENT_ATTR = "locus.recipientId";

export type TestCallTicket = { url: string; token: string; room: string };

/** Issues a LiveKit token for a browser call to the recipient's own Locus. */
export interface TestCallIssuer {
  issue(recipientId: string): Promise<TestCallTicket>;
}

export class LiveKitTestCalls implements TestCallIssuer {
  constructor(
    private readonly url: string,
    private readonly apiKey: string,
    private readonly apiSecret: string,
  ) {}

  async issue(recipientId: string): Promise<TestCallTicket> {
    const room = `test-${randomUUID()}`;
    const at = new AccessToken(this.apiKey, this.apiSecret, {
      identity: `tester-${randomUUID().slice(0, 8)}`,
      ttl: "15m",
      // Attributes in the token can't be changed by the browser (no canUpdateOwnMetadata grant).
      attributes: { [TEST_CALL_RECIPIENT_ATTR]: recipientId },
    });
    at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canUpdateOwnMetadata: false });
    at.roomConfig = new RoomConfiguration({ agents: [new RoomAgentDispatch({ agentName: "locus-guide" })] });
    return { url: this.url, token: await at.toJwt(), room };
  }
}
