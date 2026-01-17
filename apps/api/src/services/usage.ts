import { prisma } from "@mydost/db";

export const usageDateKey = (date = new Date()): string => {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}${month}${day}`;
};

export const incrementUsage = async (userId: string) => {
  const dateKey = usageDateKey();
  return prisma.usageMetric.upsert({
    where: { userId_dateKey: { userId, dateKey } },
    create: { userId, dateKey, messageCount: 1, lastMessageAt: new Date() },
    update: { messageCount: { increment: 1 }, lastMessageAt: new Date() }
  });
};

export const getUsage = async (userId: string) => {
  const dateKey = usageDateKey();
  const metric = await prisma.usageMetric.findUnique({
    where: { userId_dateKey: { userId, dateKey } }
  });
  return metric ?? { messageCount: 0, dateKey };
};
