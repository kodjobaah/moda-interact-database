CREATE TABLE "shopify"."ShopBrand" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "brandName" TEXT,
    "logoUrl" TEXT,
    "logoAltText" TEXT,
    "logoWidth" INTEGER,
    "logoHeight" INTEGER,
    "squareLogoUrl" TEXT,
    "squareLogoAltText" TEXT,
    "coverImageUrl" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRefreshedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopBrand_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShopBrand_shopId_key" ON "shopify"."ShopBrand"("shopId");

ALTER TABLE "shopify"."ShopBrand"
ADD CONSTRAINT "ShopBrand_shopId_fkey"
FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id")
ON DELETE CASCADE ON UPDATE CASCADE;