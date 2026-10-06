/**
 * ESLint 配置（2026-10-06 新增，宪法 I / IV / 技术治理）。
 *
 * ## 为什么用 .js 而不是 .json
 *
 * 需要在配置里写清「规则等级为何这样定」的取舍理由——JSON 不支持注释，
 * 而这类理由若不留档，后人只会看到 "warn" 而误以为已达标。
 *
 * ## 范围：只开宪法硬条款，不做风格规范
 *
 * 风格（缩进/引号/分号）交给既有约定与 Prettier，不在 lint 里重复规定，
 * 避免与格式化工具打架。
 *
 * ## a11y 三条为何是 warn 而非 error
 *
 * 2026-10-06 引入 eslint 时，这些规则暴露出**约 27 处存量违规**
 * （page.tsx / DeployedVersionBadge / ConversationChat / ConversationManager /
 *   OntologyDeployer / ProcessTable），全部属于 agent 环节之外的存量代码。
 *
 * 定为 error 会让 `npm run lint` 从第一天就红 —— 不可用的门禁等于没有门禁，
 * 开发者会养成忽略它的习惯。故先降为 warn：让门禁可跑、可报告、能看见存量债，
 * 待逐模块收敛后再升为 error。
 *
 * **收敛完成前不得删除本段注释。**
 */
module.exports = {
  root: true,
  extends: ['next/core-web-vitals'],
  plugins: ['@typescript-eslint', 'jsx-a11y'],
  parser: '@typescript-eslint/parser',
  parserOptions: { project: './tsconfig.json' },
  rules: {
    // 宪法 I：MUST NOT 使用 any 逃逸（全仓存量较多，先 warn 逐步收敛）
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    // 宪法 IV：可交互元素必须可键盘操作 + label 必须关联控件（存量 27 处，见文件头）
    'jsx-a11y/click-events-have-key-events': 'warn',
    'jsx-a11y/no-static-element-interactions': 'warn',
    'jsx-a11y/label-has-associated-control': 'warn',
  },
  overrides: [
    {
      // 测试文件允许 any（构造假数据）与静态元素交互（简化用例）
      files: ['**/*.test.ts', '**/*.test.tsx', 'src/test/**'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        'jsx-a11y/click-events-have-key-events': 'off',
        'jsx-a11y/no-static-element-interactions': 'off',
      },
    },
  ],
  ignorePatterns: ['node_modules/', '.next/', 'out/', 'coverage/'],
};