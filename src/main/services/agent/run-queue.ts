// =============================================================
// Agent 运行串行队列 — 排队/串行调度/abort 代数
// （从 agent-service.ts 抽出，纯重构零行为变化；
//   时序、日志前缀、abort 语义逐字保留）
// =============================================================

/**
 * 运行串行队列: 同一 agent 的多次 runAgent 请求排队执行。
 * 此前并发调用直接抛 "Agent is already running",聊天页/定时任务/飞书互相打架,
 * 用户聊天时碰上 cron 触发就会收到一条难看的错误消息。改为排队后:
 * 后来的请求等前面的跑完再执行,彻底消除该错误。
 */
export class AgentRunQueue {
  private tails: Map<string, Promise<unknown>> = new Map()
  /** 各 agent 当前排队深度(含正在等待的),用于限制队列上限 */
  private depths: Map<string, number> = new Map()
  /** abort 代数: abort 时 +1,排队中的任务出队时发现代数变化则放弃执行 */
  private generations: Map<string, number> = new Map()
  /** 单 agent 最大排队深度,超过则拒绝(防止 cron 密集触发时队列无限增长) */
  readonly maxDepth = 8

  /** 队列 tail 只读视图(LOW-1 回归测试经 agentService.runQueueTails 访问) */
  getTails(): ReadonlyMap<string, Promise<unknown>> {
    return this.tails
  }

  /** 当前排队深度(含正在等待的) */
  getDepth(id: string): number {
    return this.depths.get(id) ?? 0
  }

  /** generation 是否仍为当前代(abort 时 +1 使旧代任务失效) */
  isCurrentGeneration(id: string, generation: number): boolean {
    return (this.generations.get(id) ?? 0) === generation
  }

  /**
   * 排队执行任务: 挂到该 agent 的队尾,出队时若代数已变(被 abort)则放弃执行。
   * 返回任务 promise(放弃执行时 resolve undefined)。
   */
  enqueue<T>(id: string, task: (generation: number) => Promise<T>): Promise<T | undefined> {
    const generation = this.generations.get(id) ?? 0
    this.depths.set(id, (this.depths.get(id) ?? 0) + 1)
    const tail = this.tails.get(id) ?? Promise.resolve()
    const run = tail
      .catch(() => {
        // 前序运行失败不阻塞后续队列
      })
      .then(async () => {
        this.depths.set(id, Math.max(0, (this.depths.get(id) ?? 1) - 1))
        // 排队期间被 abort → 放弃执行
        if (!this.isCurrentGeneration(id, generation)) {
          console.log(`[AgentService] runAgent(${id}) dequeued by abort, skip`)
          return undefined
        }
        return task(generation)
      })
    this.tails.set(id, run)
    // LOW-1 修复: run settle 后清理 tail,释放闭包持有的 win/prompt/history(防窗口关闭后泄漏)
    const cleanupTail = () => {
      if (this.tails.get(id) === run) this.tails.delete(id)
    }
    run.then(cleanupTail, cleanupTail)
    return run
  }

  /**
   * abort 指定 agent 的排队任务(在途运行的 abort 由 abortAgent 处理)。
   * 返回该 agent 是否还有排队中的任务。
   */
  abortQueued(id: string): boolean {
    const queued = (this.depths.get(id) ?? 0) > 0
    // 代数 +1(无条件): 排队中的任务出队时发现代数变化即放弃执行(清空等待队列)。
    // 必须无条件递增 — executeRun 启动窗口(buildAgentTools await 期间)runningAgents 未注册、
    // depth 已自减,若跳过递增,该窗口内的 abort 会完全失效(MEDIUM-2)。
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1)
    // MEDIUM-1 修复: 重置排队深度 — 否则队列排满(8)时 abort,死任务逐个出队前新请求被误拒"排队已满"。
    // 出队自减有 Math.max(0, ...) 兜底,不会减成负数。
    this.depths.delete(id)
    return queued
  }

  /** 清空所有 agent 的排队队列(代数 +1 让出队任务放弃执行) */
  clearAllQueued(): void {
    for (const id of this.depths.keys()) {
      this.generations.set(id, (this.generations.get(id) ?? 0) + 1)
      this.depths.delete(id)
    }
  }
}
