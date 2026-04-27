# 公众号文章内容提取 API 对接文档

## 概述

从微信公众号文章 URL 提取文章标题和正文内容，同时返回**纯文本**和**带格式富文本**两种格式，可直接用于内容处理（如转小红书、内容分析等）。

认证方式与 `/api/xhs/convert` 完全一致，只需在请求体中传入 `token` 即可。

---

## 接口信息

| 项目 | 说明 |
|------|------|
| **请求地址** | `POST /api/wechat/article/extract` |
| **认证方式** | 请求体中的 `token` 字段 |
| **Content-Type** | `application/json` |

---

## 请求参数

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
|--------|------|------|--------|------|
| `token` | string | 是 | - | 用户 token（与转小红书接口相同） |
| `article_url` | string | 是 | - | 微信公众号文章 URL |
| `need_read_stats` | bool | 否 | `false` | 是否返回阅读/点赞等统计数据 |

> **说明**：短链接（如 `https://mp.weixin.qq.com/s/xxxxx`）和长链接均支持，系统自动转换。

---

## 请求示例

### cURL

```bash
curl -X POST "https://your-domain.com/api/wechat/article/extract" \
  -H "Content-Type: application/json" \
  -d '{
    "token": "your_token_here",
    "article_url": "https://mp.weixin.qq.com/s/yKAeLyrbyjGUZti6nfJc8g"
  }'
```

### Python

```python
import requests

response = requests.post(
    "https://your-domain.com/api/wechat/article/extract",
    json={
        "token": "your_token_here",
        "article_url": "https://mp.weixin.qq.com/s/yKAeLyrbyjGUZti6nfJc8g",
        "need_read_stats": False
    }
)
result = response.json()

if result["code"] == 0:
    data = result["data"]
    print(f"标题: {data['title']}")
    print(f"纯文本长度: {data['content_length']}")
    print(f"富文本长度: {data['content_multi_text_length']}")
    print(f"纯文本内容:\n{data['content'][:500]}")
    print(f"富文本内容:\n{data['content_multi_text'][:500]}")
else:
    print(f"错误 {result['code']}: {result['message']}")
```

### JavaScript (Node.js)

```javascript
const response = await fetch('https://your-domain.com/api/wechat/article/extract', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    token: 'your_token_here',
    article_url: 'https://mp.weixin.qq.com/s/yKAeLyrbyjGUZti6nfJc8g'
  })
});

const { code, data } = await response.json();
if (code === 0) {
  console.log('标题:', data.title);
  console.log('纯文本:', data.content);
  console.log('富文本:', data.content_multi_text);
}
```

---

## 成功响应

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "title": "文章标题",
    "content": "这是纯文本内容，不含任何格式标记...",
    "content_multi_text": "[title]文章标题[/title]\n[text]第一段内容。[/text]\n[subtitle]小标题[/subtitle]\n...",
    "item_show_type": 0,
    "picture_page_info_list": [],
    "read_stats": {
      "read": 0,
      "zan": 0,
      "looking": 0,
      "share_count": 0,
      "collect_count": 0,
      "comment_count": 0
    },
    "content_length": 5678,
    "content_multi_text_length": 6789,
    "extract_time": 2.34
  }
}
```

### 响应字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `data.title` | string | 文章标题 |
| `data.content` | string | **纯文本**：无任何格式标记，适合关键词提取、摘要等 |
| `data.content_multi_text` | string | **富文本**：带结构化标记（`[title]`/`[subtitle]`/`[text]` 等），适合保留格式的内容转换 |
| `data.item_show_type` | int | 文章类型，`8` = 小绿书 |
| `data.picture_page_info_list` | array | 小绿书图片列表（仅 `item_show_type=8` 有值） |
| `data.read_stats` | object | 统计数据，仅 `need_read_stats=true` 时有实际值 |
| `data.content_length` | int | 纯文本字符数 |
| `data.content_multi_text_length` | int | 富文本字符数 |
| `data.extract_time` | float | 提取耗时（秒） |

### content 与 content_multi_text 对比

| 字段 | 格式示例 | 适用场景 |
|------|----------|----------|
| `content` | `正文段落一。正文段落二。` | 文本分析、关键词提取、全文搜索 |
| `content_multi_text` | `[title]标题[/title]\n[text]段落[/text]` | 转小红书笔记、保留排版的内容迁移 |

---

## 错误码

| code | HTTP 状态 | 说明 |
|------|-----------|------|
| 0 | 200 | 成功 |
| 400 | 400 | 参数错误（缺少 token / article_url，或 URL 格式不正确） |
| 403 | 403 | Token 验证失败（无效、已过期或余额不足） |
| 404 | 404 | 文章内容提取失败（URL 错误或文章已删除） |
| 500 | 500 | 服务器内部错误 |

### 错误响应示例

```json
{"code": 400, "message": "缺少token参数"}
{"code": 403, "message": "Token验证失败: token已过期"}
{"code": 400, "message": "请输入有效的微信公众号文章链接"}
{"code": 404, "message": "未能提取到文章内容，请检查URL是否正确或文章是否已被删除"}
```

---

## 计费说明

| 场景 | 扣费 |
|------|------|
| 成功提取文章内容 | **0.1 积分 / 次** |
| 提取失败（404 / 500） | 不扣费 |
| Token 验证失败（400 / 403） | 不扣费 |

- 扣费在**成功返回内容后**执行，失败不计费。
- 消费记录可在后台消费历史中查看，产品类型为「公众号文章提取」。
- 开启 `need_read_stats: true` 不额外收费，仍为 0.1 积分/次。

---

## 与转小红书接口的对比

| 项目 | `/api/xhs/convert` | `/api/wechat/article/extract` |
|------|--------------------|---------------------------------|
| 认证 | `token`（请求体） | `token`（请求体，相同） |
| 输入 | `article_url` 或 `plain_text` | `article_url` |
| 执行方式 | 异步任务，返回 `task_id` | **同步**，直接返回内容 |
| 返回 | AI 改写后的小红书内容 | 原始文章的纯文本 + 富文本 |
| 费用 | 按内容计费 | **0.1 积分 / 次** |

---

## 注意事项

1. **同步接口**：本接口同步返回结果，无需轮询任务状态。响应时间通常 2-8 秒。
2. **短链接**：自动将微信短链接转换为长链接再抓取。
3. **阅读统计**：默认不获取，设置 `need_read_stats: true` 后会额外耗时约 1-3 秒。
4. **小绿书**：`item_show_type=8` 时，`picture_page_info_list` 包含图片信息。

---

## 变更记录

| 日期 | 版本 | 说明 |
|------|------|------|
| 2026-03-23 | v1.0 | 初始版本，token 认证，与 `/api/xhs/convert` 逻辑一致 |
| 2026-03-23 | v1.1 | 新增计费逻辑：成功提取扣 0.1 积分/次，失败不扣费 |
