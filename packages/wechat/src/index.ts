/**
 * @reelforge/wechat 公共入口
 *
 * 当前只封装"公众号文章提取"一个外部接口；后续若扩展（如视频号、图文搬运）
 * 新增 client.ts 同目录同层即可，对外导出统一从本文件出口。
 */

export * from "./client.js";
