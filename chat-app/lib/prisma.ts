import { PrismaClient } from '@/app/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

function createPrismaClient() {
  if (process.env.DATABASE_URL?.startsWith('file:')) {
    // ローカル開発: SQLite (libsql経由)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaLibSql } = require('@prisma/adapter-libsql')
    const path = require('path')
    const dbPath = path.join(process.cwd(), 'prisma', 'dev.db')
    const adapter = new PrismaLibSql({ url: `file:${dbPath}` })
    return new PrismaClient({ adapter } as any)
  }
  // 本番: PostgreSQL
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
  return new PrismaClient({ adapter } as any)
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma = globalForPrisma.prisma || createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
