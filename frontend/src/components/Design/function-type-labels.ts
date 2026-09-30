/**
 * 函数类型展示口径（spec 003）：**落盘为英文码，展示态统一中文**。
 *
 * 单一事实源：下拉选项的 label（中文 + 英文码）与展示态的中文标签同源于
 * FUNCTION_TYPE_LABELS，避免出现「选择时显示中文、选择完毕后显示英文码」的漂移。
 * 英文码与 prompts.py 阶段5A 的 5 类一一对应，也是 LLM 生成时写入 YAML 的值。
 */

/** 英文码 → 中文标签 */
export const FUNCTION_TYPE_LABELS: Record<string, string> = {
  TRANSFORMATION: '格式转换',
  CALCULATION: '指标计算',
  DERIVATION: '属性派生',
  VALIDATION: '逻辑验证',
  MODEL: '机器学习模型',
};

/** 下拉选项：label 展示「中文 (英文码)」，value 即落盘英文码 */
export const FUNCTION_TYPE_OPTIONS = Object.entries(FUNCTION_TYPE_LABELS)
  .map(([value, label]) => ({ label: `${label} (${value})`, value }));

/** 展示态标签：空值显示 `-`；未知码回退原值（不吞信息，便于发现脏数据） */
export function functionTypeLabel(code?: string): string {
  if (!code) return '-';
  return FUNCTION_TYPE_LABELS[code] || code;
}
