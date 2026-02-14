# UI 设计规范

本文档记录 cc-gw Web UI 优化涉及的设计决策，作为后续开发的参考基准。

## 骨架屏规范

- 基础色：`bg-muted`
- 动画：`animate-pulse`
- 圆角与间距：与实际内容组件保持一致
- 组合骨架应模拟真实布局结构（stat card、chart、table row）

## 加载态策略

- 首屏加载：使用骨架屏（Skeleton），保持布局稳定不跳动
- 操作反馈（保存、刷新等）：使用按钮内 spinner 或 disabled 状态
- 数据刷新：保留旧数据展示，后台静默刷新

## 空状态规范

- Icon：lucide 图标，`h-10 w-10 text-muted-foreground/50`
- 主文案：`text-sm text-muted-foreground`
- 引导文案（可选）：`text-xs text-muted-foreground`
- 容器：`rounded-lg border border-dashed` + 居中布局

## 侧边栏 Tooltip

- compact 模式下所有 nav item 必须有 Tooltip
- 使用 `@/components/ui/tooltip` 组件
- `side="right"`，`delayDuration={0}`
- 内容为 `t(item.labelKey)`

## 筛选区折叠规范

- 默认折叠
- 活跃筛选以 Badge 摘要展示（如 "Provider: kimi"、"Status: 成功"）
- 点击 badge 可移除该筛选
- 摘要行右侧放展开/收起按钮（ChevronDown/ChevronUp）
- 无活跃筛选时显示 "全部请求" 文字

## Settings 锚点导航

- 布局：`grid grid-cols-1 xl:grid-cols-[200px_1fr] gap-6`
- 左侧导航：`sticky top-20`
- 每个 Card section 加 `id` 属性
- 点击导航项 `scrollIntoView({ behavior: 'smooth' })`
- `IntersectionObserver` 监听各 section 可见性，高亮当前 section
- 移动端（`xl` 以下）隐藏侧边导航

## Toast 动画

- 入场：`animate-slide-in-right`（从右侧滑入）
- 退场：`animate-fade-out`（淡出）
- 退场实现：给 toast 加 `dismissing` 状态，触发退场动画，`onAnimationEnd` 后移除 DOM

## 颜色对应关系

Stat card 颜色与图表 series 颜色保持一致：

| 指标 | 颜色 | Tailwind | Hex |
|------|------|----------|-----|
| 请求数 | blue | `blue-500` | `#3b82f6` |
| 输入 Tokens | emerald | `emerald-500` | `#10b981` |
| 输出 Tokens | amber | `amber-500` | `#f59e0b` |
| 缓存读取 | violet | `violet-500` | `#8b5cf6` |
| 缓存写入 | rose | `rose-500` | `#f43f5e` |
| 平均耗时 | cyan | `cyan-500` | `#06b6d4` |

图表 series 引用 `METRIC_COLORS` 常量，与 stat card 颜色一一对应。
