import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * bullmq をモックし、実 Redis なしで createIngestionRuntime の配線
 * （Queue/Worker 生成・スケジュール登録・バックフィル enqueue・shutdown 順序）を検証する。
 */
const addMock = vi.fn();
const queueCloseMock = vi.fn();
const workerCloseMock = vi.fn();
const workerOnMock = vi.fn();

vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation((name: string) => ({
    name,
    add: addMock,
    close: queueCloseMock,
  })),
  Worker: vi.fn().mockImplementation((name: string) => ({
    name,
    on: workerOnMock,
    close: workerCloseMock,
  })),
}));

const importRuntime = async () => await import("./worker.js");

import { loadWorkerConfig } from "./config.js";
import { FakeMarketData, FakeRepository } from "./test-fakes.js";

const deps = () => ({ market: new FakeMarketData(), repo: new FakeRepository() });
const silentLog = { info: () => {}, warn: () => {}, error: () => {} };

describe("createIngestionRuntime", () => {
  beforeEach(() => {
    addMock.mockReset();
    queueCloseMock.mockReset();
    workerCloseMock.mockReset();
    workerOnMock.mockReset();
  });

  it("scheduleEnabled なら repeatable ジョブを登録する", async () => {
    const { createIngestionRuntime } = await importRuntime();
    const config = loadWorkerConfig({ INGEST_UNIVERSE: "TSE:7203,NASDAQ:AAPL" });
    const rt = createIngestionRuntime({ config, deps: deps(), logger: silentLog });
    await rt.registerSchedules();
    // 2 銘柄 poll-quote + 1 FX = 3 件、すべて repeat 付き
    expect(addMock).toHaveBeenCalledTimes(3);
    for (const call of addMock.mock.calls) {
      expect(call[2]).toHaveProperty("repeat");
      expect(call[2]).toHaveProperty("jobId");
    }
  });

  it("scheduleEnabled=false なら何も登録しない", async () => {
    const { createIngestionRuntime } = await importRuntime();
    const config = loadWorkerConfig({
      INGEST_UNIVERSE: "TSE:7203",
      INGEST_SCHEDULE_ENABLED: "false",
    });
    const rt = createIngestionRuntime({ config, deps: deps(), logger: silentLog });
    await rt.registerSchedules();
    expect(addMock).not.toHaveBeenCalled();
  });

  it("enqueueBackfill は各銘柄に単発ジョブを積む", async () => {
    const { createIngestionRuntime } = await importRuntime();
    const config = loadWorkerConfig({ INGEST_UNIVERSE: "TSE:7203,NASDAQ:AAPL" });
    const rt = createIngestionRuntime({ config, deps: deps(), logger: silentLog });
    await rt.enqueueBackfill();
    expect(addMock).toHaveBeenCalledTimes(2);
    // repeat オプションは付けない（単発）
    expect(addMock.mock.calls[0]?.[2]).toBeUndefined();
  });

  it("shutdown は worker → queue の順で閉じる", async () => {
    const { createIngestionRuntime } = await importRuntime();
    const order: string[] = [];
    workerCloseMock.mockImplementation(async () => void order.push("worker"));
    queueCloseMock.mockImplementation(async () => void order.push("queue"));
    const config = loadWorkerConfig({});
    const rt = createIngestionRuntime({ config, deps: deps(), logger: silentLog });
    await rt.shutdown();
    expect(order).toEqual(["worker", "queue"]);
  });
});
