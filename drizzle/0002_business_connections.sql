CREATE TABLE "tg_business_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_tg_user_id" bigint NOT NULL,
	"owner_username" text,
	"owner_name" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
