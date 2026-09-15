/**
 * 消息导航的阅读位置计算。
 *
 * Responsibilities:
 * - 根据可见消息在滚动内容中的位置确定当前阅读消息。
 *
 * Notes:
 * - 不依赖 DOM 或持久化数据，消息标识始终保留原值。
 */

/** 消息锚点在滚动内容中的位置。 */
export interface MessagePosition {
  id: string;
  top: number;
}

/** 选择视口顶部附近的消息，到达可滚动内容底部时选择最后一条。 */
export function findReadingMessageId(
  positions: MessagePosition[],
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
): string | null {
  if (positions.length === 0) return null;
  if (scrollHeight > clientHeight && scrollTop + clientHeight >= scrollHeight - 2) {
    return positions[positions.length - 1]!.id;
  }
  const readingTop = scrollTop + Math.min(48, clientHeight / 5);
  let activeId = positions[0]!.id;
  for (const position of positions) {
    if (position.top > readingTop) break;
    activeId = position.id;
  }
  return activeId;
}
