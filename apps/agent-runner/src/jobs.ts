/** BullMQ キュー/ジョブ名（自律エージェントループ）。 */
export const QUEUE_NAME = "agent-runner";

export const JOB = {
  /** 1 反復の自律ループ（観測→判断→記録/発注）。 */
  RunLoop: "run-loop",
} as const;

/** RunLoop ジョブのペイロード。どの口座をどのエージェントとして回すか。 */
export interface RunLoopPayload {
  accountId: string;
  agentProfileId: string;
}
