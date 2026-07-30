-- CreateTable
CREATE TABLE "Race" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL DEFAULT 'Race to 1 Mil',
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "startingCapital" DECIMAL(65,30) NOT NULL DEFAULT 10000,
    "status" TEXT NOT NULL DEFAULT 'setup',
    "startedAt" TIMESTAMP(3),

    CONSTRAINT "Race_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Player" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "strategy" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT '#8884d8',

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" SERIAL NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "priceSource" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "quoteCurrency" TEXT NOT NULL DEFAULT 'EUR',

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" SERIAL NOT NULL,
    "playerId" INTEGER NOT NULL,
    "assetId" INTEGER NOT NULL,
    "allocation" DECIMAL(65,30) NOT NULL,
    "quantity" DECIMAL(65,30),
    "startPrice" DECIMAL(65,30),

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Snapshot" (
    "id" SERIAL NOT NULL,
    "playerId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "totalValue" DECIMAL(65,30) NOT NULL,
    "breakdown" JSONB NOT NULL,
    "stale" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Asset_symbol_key" ON "Asset"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "Position_playerId_assetId_key" ON "Position"("playerId", "assetId");

-- CreateIndex
CREATE UNIQUE INDEX "Snapshot_playerId_date_key" ON "Snapshot"("playerId", "date");

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Snapshot" ADD CONSTRAINT "Snapshot_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
