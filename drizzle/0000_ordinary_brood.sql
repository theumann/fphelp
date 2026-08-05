CREATE TYPE "public"."message_channel" AS ENUM('whatsapp', 'email');--> statement-breakpoint
CREATE TYPE "public"."owner_role" AS ENUM('communicator', 'treasurer');--> statement-breakpoint
CREATE TYPE "public"."prize_kind" AS ENUM('gw_winner_fixed', 'season_best_gw_fixed', 'season_rank_pct');--> statement-breakpoint
CREATE TYPE "public"."winning_status" AS ENUM('provisional', 'final');--> statement-breakpoint
CREATE TABLE "digests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"gameweek" integer NOT NULL,
	"stats" jsonb NOT NULL,
	"prepared_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "digests_league_gameweek_key" UNIQUE("league_id","gameweek")
);
--> statement-breakpoint
CREATE TABLE "dues" (
	"league_id" uuid NOT NULL,
	"entry" integer NOT NULL,
	"amount" numeric(12, 2),
	"paid" boolean DEFAULT false NOT NULL,
	"paid_at" timestamp with time zone,
	"note" text,
	CONSTRAINT "dues_league_id_entry_pk" PRIMARY KEY("league_id","entry")
);
--> statement-breakpoint
CREATE TABLE "league_users" (
	"league_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "owner_role" DEFAULT 'communicator' NOT NULL,
	"manager_entry" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "league_users_league_id_user_id_pk" PRIMARY KEY("league_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "leagues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fpl_league_id" integer NOT NULL,
	"name" text NOT NULL,
	"start_event" integer,
	"pot_total" numeric(12, 2),
	"currency" text DEFAULT 'USD' NOT NULL,
	"entry_fee" numeric(12, 2),
	"default_blocks" jsonb DEFAULT '{"overallStandings":true,"gwResults":true,"prizeStructure":false}'::jsonb NOT NULL,
	"email_enabled" boolean DEFAULT false NOT NULL,
	"notify_on_gw_finish" boolean DEFAULT false NOT NULL,
	"finalised_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leagues_fpl_league_id_unique" UNIQUE("fpl_league_id")
);
--> statement-breakpoint
CREATE TABLE "manager_gw_history" (
	"league_id" uuid NOT NULL,
	"entry" integer NOT NULL,
	"gameweek" integer NOT NULL,
	"points" integer NOT NULL,
	"total_points" integer NOT NULL,
	"rank" integer,
	"overall_rank" integer,
	"points_on_bench" integer,
	"event_transfers_cost" integer,
	CONSTRAINT "manager_gw_history_league_id_entry_gameweek_pk" PRIMARY KEY("league_id","entry","gameweek")
);
--> statement-breakpoint
CREATE TABLE "managers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"entry" integer NOT NULL,
	"entry_name" text NOT NULL,
	"player_name" text NOT NULL,
	"joined_time" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "managers_league_entry_key" UNIQUE("league_id","entry")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"digest_id" uuid,
	"channel" "message_channel" DEFAULT 'whatsapp' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"blocks" jsonb NOT NULL,
	"sent_text" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"marked_sent_by" uuid
);
--> statement-breakpoint
CREATE TABLE "prize_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"kind" "prize_kind" NOT NULL,
	"rank" integer,
	"value" numeric(12, 4) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "winnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"entry" integer NOT NULL,
	"kind" "prize_kind" NOT NULL,
	"gameweek" integer,
	"amount" numeric(12, 2) NOT NULL,
	"status" "winning_status" DEFAULT 'provisional' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "digests" ADD CONSTRAINT "digests_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dues" ADD CONSTRAINT "dues_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_users" ADD CONSTRAINT "league_users_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_users" ADD CONSTRAINT "league_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_gw_history" ADD CONSTRAINT "manager_gw_history_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managers" ADD CONSTRAINT "managers_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_digest_id_digests_id_fk" FOREIGN KEY ("digest_id") REFERENCES "public"."digests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_marked_sent_by_users_id_fk" FOREIGN KEY ("marked_sent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prize_rules" ADD CONSTRAINT "prize_rules_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipients" ADD CONSTRAINT "recipients_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "winnings" ADD CONSTRAINT "winnings_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;