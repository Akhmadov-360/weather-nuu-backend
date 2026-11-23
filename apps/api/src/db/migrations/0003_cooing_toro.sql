CREATE TABLE IF NOT EXISTS "assistant_rate_hits" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_rate_hits_key_at_idx" ON "assistant_rate_hits" USING btree ("key","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_rate_hits_at_idx" ON "assistant_rate_hits" USING btree ("at");