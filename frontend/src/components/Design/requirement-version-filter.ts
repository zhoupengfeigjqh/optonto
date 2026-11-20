/**
 * 需求汇总：版本号筛选的纯逻辑（唯一实现）。
 *
 * 设计要点（见 specs/011-requirement-version-filter/）：
 * 1. 「全部」「未填写版本」使用**保留值**（`__all__` / `__unset__`）作为选项 value，
 *    不以中文展示文本充当 value —— 版本号是用户自由输入的，字面可能正好等于「全部」。
 * 2. 排序为**自然降序**（数字段按数值、非数字段按字符串），不依赖 `localeCompare`
 *    的 locale 行为，也不解析语义化版本（`2026-11-20`、`v1.0-beta` 都要能排）。
 * 3. 去重只做 trim，**不折叠大小写**：`v1.0` 与 `V1.0` 是两个版本。
 * 4. 本模块不依赖 React / 网络 / DOM，便于穷举规则与纳入覆盖率门禁。
 */

/** 「全部」的保留值（不可与用户输入的版本号冲突） */
export const ALL_VERSIONS = '__all__';
/** 「未填写版本」的保留值 */
export const UNSET_VERSION = '__unset__';
export const ALL_VERSIONS_LABEL = '全部';
export const UNSET_VERSION_LABEL = '未填写版本';

export interface VersionOption {
  value: string;
  label: string;
}

/** 只要求具备 version 字段，避免本模块反向依赖 API 层类型 */
export interface VersionedItem {
  version?: string | null;
}

/** 版本号规范化：仅去首尾空格；空值统一为 `''`；不折叠大小写 */
export function normalizeVersion(raw: string | null | undefined): string {
  return (raw ?? '').trim();
}

export function versionKeyOf(item: VersionedItem): string {
  return normalizeVersion(item.version);
}

/** 拆成「连续数字段」与「非数字段」交替的序列，用于自然比较 */
function versionParts(value: string): Array<string | number> {
  const parts: Array<string | number> = [];
  const re = /(\d+)|(\D+)/g;
  let match = re.exec(value);
  while (match !== null) {
    parts.push(match[1] === undefined ? match[2] : Number(match[1]));
    match = re.exec(value);
  }
  return parts;
}

/**
 * 自然降序比较器（供 `Array.prototype.sort` 使用：返回负数表示 a 排在 b 前面）。
 *
 * 例：`compareVersionDesc('v1.10', 'v1.9') < 0`（v1.10 更新，排在前面）。
 */
export function compareVersionDesc(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);
  const len = Math.max(left.length, right.length);

  for (let i = 0; i < len; i += 1) {
    const x = left[i];
    const y = right[i];
    // 前缀更短视为更旧（v1 排在 v1.0 之后）
    if (x === undefined) return 1;
    if (y === undefined) return -1;

    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x > y ? -1 : 1;
      continue;
    }
    if (typeof x === 'string' && typeof y === 'string') {
      if (x !== y) return x > y ? -1 : 1;
      continue;
    }
    // 同位置一为数字一为字符串：数字段视为更新，保证排序确定
    return typeof x === 'number' ? -1 : 1;
  }
  return 0;
}

/**
 * 由当前列表推导下拉选项：`全部` + 去重后的版本号（降序）+ 可选 `未填写版本`（置末）。
 *
 * 不在数据中的版本号不会出现（避免"选了必空"的死选项）。
 */
export function buildVersionOptions(items: readonly VersionedItem[]): VersionOption[] {
  const versions = new Set<string>();
  let hasUnset = false;

  for (const item of items) {
    const key = versionKeyOf(item);
    if (key === '') {
      hasUnset = true;
    } else {
      versions.add(key);
    }
  }

  const options: VersionOption[] = [{ value: ALL_VERSIONS, label: ALL_VERSIONS_LABEL }];
  for (const version of Array.from(versions).sort(compareVersionDesc)) {
    options.push({ value: version, label: version });
  }
  if (hasUnset) {
    options.push({ value: UNSET_VERSION, label: UNSET_VERSION_LABEL });
  }
  return options;
}

/**
 * 按选择值过滤：保持原有相对顺序（只改行集合，不重排）。
 *
 * `selected` 为未知值时返回空数组；调用方**必须**在派生阶段先用
 * `resolveSelectionAfterChange` 校正，不能只靠渲染后的 effect 回落（否则会闪一帧空表）。
 */
export function filterByVersion<T extends VersionedItem>(items: readonly T[], selected: string): T[] {
  if (selected === ALL_VERSIONS) return items.slice();
  return items.filter((item) => {
    const key = versionKeyOf(item);
    if (selected === UNSET_VERSION) return key === '';
    return key === selected;
  });
}

/** 选中项失效（对应版本已无文档）时回落到「全部」，否则原样返回 */
export function resolveSelectionAfterChange(options: readonly VersionOption[], selected: string): string {
  if (options.some((option) => option.value === selected)) return selected;
  return ALL_VERSIONS;
}
