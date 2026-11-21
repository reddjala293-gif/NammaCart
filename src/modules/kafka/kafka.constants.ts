export const KAFKA_TOPICS = {
  INVENTORY_CHANGES: process.env.KAFKA_TOPIC_INVENTORY_CHANGES || 'inventory.changes',
  ORDERS_CREATED: process.env.KAFKA_TOPIC_ORDERS_CREATED || 'orders.created',
  SEARCH_SYNC: process.env.KAFKA_TOPIC_SEARCH_SYNC || 'search.index.sync',
};

export const KAFKA_EVENTS = {
  ITEM_RESERVED: 'item.reserved',
  ITEM_SOLD: 'item.sold',
  ITEM_RELEASED: 'item.released',
  ORDER_PLACED: 'order.placed',
};
