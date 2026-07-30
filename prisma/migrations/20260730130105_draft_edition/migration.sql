-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "passwordHash" TEXT NOT NULL,
ADD COLUMN     "username" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Position" ADD COLUMN     "pickIndex" INTEGER;

-- AlterTable
ALTER TABLE "Race" ADD COLUMN     "currentPickIndex" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "draftOrder" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "inviteCode" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "perPickAmount" DECIMAL(65,30) NOT NULL DEFAULT 1000,
ADD COLUMN     "picksPerPlayer" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "scheduledStartAt" TIMESTAMP(3),
ALTER COLUMN "currency" SET DEFAULT 'USD',
ALTER COLUMN "status" SET DEFAULT 'registration';

-- CreateIndex
CREATE UNIQUE INDEX "Player_username_key" ON "Player"("username");

