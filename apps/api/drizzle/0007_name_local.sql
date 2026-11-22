-- Landmark names in the home state's language (Telugu or Kannada), not Kannada only.
ALTER TABLE "locus"."walkProposals" RENAME COLUMN "nameKn" TO "nameLocal";
