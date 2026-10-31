'use client';

/**
 * 规则设计智能生成的**唯一调用入口**（spec 008）。
 *
 * 组件只消费 `loading` / `generate`，不直接碰 API；错误原样抛给调用方决定提示文案，
 * 便于弹窗在失败时保留原设计。
 */

import { useCallback, useState } from 'react';
import {
  generateRuleDesign,
  type RuleDesignGeneratePayload,
  type RuleDesignGenerateResult,
} from '@/api/client';

export interface RuleDesignGenerateState {
  loading: boolean;
  generate: (payload: RuleDesignGeneratePayload) => Promise<RuleDesignGenerateResult>;
}

export function useRuleDesignGenerate(ontologyId: number): RuleDesignGenerateState {
  const [loading, setLoading] = useState(false);

  const generate = useCallback(async (
    payload: RuleDesignGeneratePayload,
  ): Promise<RuleDesignGenerateResult> => {
    setLoading(true);
    try {
      return await generateRuleDesign(ontologyId, payload);
    } finally {
      setLoading(false);
    }
  }, [ontologyId]);

  return { loading, generate };
}
