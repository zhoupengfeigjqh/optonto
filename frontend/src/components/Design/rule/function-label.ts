/**
 * 关联函数展示口径（2026-09-30 统一）：`中文名-类型`。
 *
 * - 公共函数：类型恒为「公共」（跨本体通用能力，不判对错、不拦执行）；
 * - 本体函数：用其预设类型（展示态统一中文，见 function-type-labels）；未标注类型回退「未分类」；
 * - 判断函数：本体且 `type=VALIDATION`——运行期返回统一信封 `data.pass/reason`，
 *   前置规则判断不通过时系统拒绝主行为（真阻断）。
 *
 * 与视图分离：RuleTable 的关联函数下拉与已选展示共用此口径，避免两处文案漂移。
 */
import { functionTypeLabel } from '../function-type-labels';

export interface FunctionLabelParts {
  /** 中文名（display_name 缺失时回退函数名） */
  base: string;
  /** 类型标签：`公共` / 本体类型中文标签 / `未分类` */
  typeLabel: string;
  /** 是否判断函数（本体且 type=VALIDATION） */
  isJudge: boolean;
}

interface LabelableFunction {
  name: string;
  display_name?: string;
  type?: string;
  /** 来源标记：`common` = 公共函数（其余视为本体函数） */
  _source?: string;
}

/** 拆解展示口径（下拉 label 与已选展示共用） */
export function functionLabelParts(fn: LabelableFunction | undefined, name: string): FunctionLabelParts {
  const isCommon = fn?._source === 'common';
  return {
    base: fn?.display_name || name,
    typeLabel: isCommon ? '公共' : (fn?.type ? functionTypeLabel(fn.type) : '未分类'),
    isJudge: !isCommon && fn?.type === 'VALIDATION',
  };
}

/** 完整展示文案：`中文名-类型` */
export function functionLabel(fn: LabelableFunction | undefined, name: string): string {
  const { base, typeLabel } = functionLabelParts(fn, name);
  return `${base}-${typeLabel}`;
}
