/**
 * 本地 job 索引：
 *
 * 后端没有提供 "GET /v1/jobs 列表" 接口（只有 GET /v1/jobs/:id 单个查询）。
 * 因此前端在浏览器 localStorage 维护一个用户自己提交过的 jobId 索引，
 * 连同前端已知的 title / createdAt 等字段一起保存，用于列表页冷启动。
 *
 * 列表页再逐个调 GET /v1/jobs/:id 拉最新状态。
 */

import type { JobStatus } from "./types";

export interface LocalJobEntry {
  jobId: string;
  title: string;
  createdAt: string;
  lastKnownStatus?: JobStatus;
  lastProgress?: number;
}

const KEY = "reelforge.jobs.v1";
const MAX_ENTRIES = 200; // 防止无限增长

function read(): LocalJobEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // localStorage 损坏或被禁用时静默退回空列表，不影响用户使用
    return [];
  }
}

function write(entries: LocalJobEntry[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    /* 配额满时忽略 */
  }
}

export const jobStore = {
  /** 读取全部，按创建时间倒序 */
  list(): LocalJobEntry[] {
    return read().sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  },

  /** 新增或更新一条记录 */
  upsert(entry: LocalJobEntry): void {
    const cur = read();
    const idx = cur.findIndex((e) => e.jobId === entry.jobId);
    if (idx >= 0) cur[idx] = { ...cur[idx], ...entry };
    else cur.unshift(entry);
    write(cur);
  },

  /** 删除一条 */
  remove(jobId: string): void {
    write(read().filter((e) => e.jobId !== jobId));
  },

  /** 只更新状态与进度，用于轮询回写 */
  patchStatus(jobId: string, status: JobStatus, progress?: number): void {
    const cur = read();
    const idx = cur.findIndex((e) => e.jobId === jobId);
    if (idx < 0) return;
    cur[idx] = {
      ...cur[idx]!,
      lastKnownStatus: status,
      lastProgress: progress,
    };
    write(cur);
  },
};
