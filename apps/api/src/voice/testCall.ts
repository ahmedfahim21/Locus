import { randomUUID } from "node:crypto";
import { RoomAgentDispatch, RoomConfiguration } from "@livekit/protocol";
import { AccessToken, AgentDispatchClient, SipClient } from "livekit-server-sdk";

/**
 * Participant attribute naming the recipient a call is for: set by the API in a
 * browser test call's token, or on the rider's leg of a call Locus places ("Call the rider"). Callers can't change it.
 */
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

/** "Call the rider": Locus phones a delivery rider on the recipient's behalf. */
export interface PhoneCaller {
  /** Places the call to the rider's phone and returns once it is ringing; the room is the call's id in logs. */
  ring(recipientId: string, riderPhone: string): Promise<{ room: string }>;
}

export class LiveKitPhoneCalls implements PhoneCaller {
  constructor(
    private readonly url: string,
    private readonly apiKey: string,
    private readonly apiSecret: string,
    private readonly trunkId: string,
    private readonly fromNumber: string,
  ) {}

  async ring(recipientId: string, riderPhone: string): Promise<{ room: string }> {
    const room = `rider-${randomUUID()}`;
    await new AgentDispatchClient(this.url, this.apiKey, this.apiSecret).createDispatch(room, "locus-guide");
    // Tagged with the recipient, so the call doesn't depend on which recipient owns the Locus number.
    await new SipClient(this.url, this.apiKey, this.apiSecret).createSipParticipant(this.trunkId, riderPhone, room, {
      participantIdentity: "rider",
      fromNumber: this.fromNumber,
      ringingTimeout: 40,
      participantAttributes: { [TEST_CALL_RECIPIENT_ATTR]: recipientId },
    });
    return { room };
  }
}
