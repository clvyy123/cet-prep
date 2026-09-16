import type { AIConfig } from '../types';
import { getSettings, saveSettings } from './storage';

export function getAIConfig(): AIConfig {
  return getSettings().ai;
}

export function setAIConfig(ai: AIConfig): void {
  const s = getSettings();
  saveSettings({ ...s, ai });
}

export function isAIReady(): boolean {
  const ai = getAIConfig();
  return ai.apiKey.trim() !== '' && ai.baseUrl.trim() !== '';
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function normalizeBase(url: string): string {
  const u = url.trim().replace(/\/+$/, '');
  return u.endsWith('/chat/completions') ? u : `${u}/chat/completions`;
}

/**
 * 调用 OpenAI 兼容的 Chat Completions 接口（支持流式）。
 * onDelta 收到增量文本；返回完整文本。
 */
export async function chat(
  messages: ChatMessage[],
  onDelta?: (delta: string) => void,
  ai?: AIConfig
): Promise<string> {
  const cfg = ai ?? getAIConfig();
  if (!cfg.apiKey || !cfg.baseUrl) {
    throw new Error('尚未配置 AI 服务，请前往「设置」填写 API 地址与密钥。');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const res = await fetch(normalizeBase(cfg.baseUrl), {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model || 'gpt-3.5-turbo',
        messages,
        stream: true,
        temperature: 0.4,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`AI 请求失败 (${res.status})：${errText.slice(0, 300)}`);
    }
    if (!res.body) throw new Error('响应无内容');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const data = t.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const delta: string | undefined = json.choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            onDelta?.(delta);
          }
        } catch {
          /* 跳过无法解析的数据块 */
        }
      }
    }
    return full;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error('AI 请求超时，请检查网络或稍后重试。');
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

export function testConnection(ai: AIConfig): Promise<string> {
  return chat(
    [{ role: 'user', content: '请只回复两个字：正常' }],
    undefined,
    ai
  );
}

// ============ 阅读助手提示词 ============
export function buildSystemPrompt(passageTitle: string, passage: string): ChatMessage {
  return {
    role: 'system',
    content:
      '你是一名专业的英语四六级备考阅读辅导老师。' +
      `用户正在学习阅读文章《${passageTitle}》。请基于以下文章内容回答问题，` +
      '回答要准确、简洁、条理清晰，中文为主，适当保留英文关键术语。\n\n' +
      `【文章内容】\n${passage}`,
  };
}

export function buildUserMessage(content: string): ChatMessage {
  return { role: 'user', content };
}
