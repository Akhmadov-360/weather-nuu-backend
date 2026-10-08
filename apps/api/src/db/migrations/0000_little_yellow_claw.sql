CREATE TABLE IF NOT EXISTS "cansat_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"temp" real,
	"pressure" real,
	"humidity" real,
	"accel_x" real,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sensor_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" varchar(10) NOT NULL,
	"hum" real,
	"bmp_press" real,
	"mq5" integer,
	"mq3" integer,
	"fused_temp" real,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cansat_data_recorded_at_idx" ON "cansat_data" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sensor_data_source_recorded_at_idx" ON "sensor_data" USING btree ("source","timestamp");