-- AviraCare Database Schema DDL
-- Generated on: 2026-08-21T01:15:05.527Z

CREATE TABLE IF NOT EXISTS "avira_products" (
  "id" SERIAL,
  "name" VARCHAR(255) NOT NULL,
  "amount" NUMERIC NOT NULL,
  "pv" INTEGER NOT NULL,
  "image_url" TEXT NOT NULL,
  "info" TEXT NOT NULL,
  "benefits" TEXT NOT NULL,
  "how_to_use" TEXT NOT NULL,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "all_images" TEXT,
  "category" VARCHAR(100) DEFAULT 'Health & Wellness'::character varying
);

CREATE TABLE IF NOT EXISTS "bill_history" (
  "id" SERIAL,
  "invoice_no" VARCHAR(100),
  "invoice_date" VARCHAR(50),
  "buyer_name" VARCHAR(255),
  "buyer_id" VARCHAR(100),
  "buyer_address" TEXT,
  "buyer_phone" VARCHAR(50),
  "buyer_state" VARCHAR(100),
  "buyer_state_code" VARCHAR(20),
  "buyer_pincode" VARCHAR(20),
  "buyer_gstin" VARCHAR(50),
  "consignee_name" VARCHAR(255),
  "consignee_address" TEXT,
  "consignee_phone" VARCHAR(50),
  "consignee_state" VARCHAR(100),
  "consignee_state_code" VARCHAR(20),
  "consignee_pincode" VARCHAR(20),
  "consignee_gstin" VARCHAR(50),
  "raw_combo_name" VARCHAR(255),
  "items" JSONB,
  "total_amount" NUMERIC,
  "total_pv" NUMERIC,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "box_presets" (
  "id" SERIAL,
  "name" VARCHAR(255) NOT NULL,
  "length" VARCHAR(50),
  "breadth" VARCHAR(50),
  "height" VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS "combo_presets" (
  "id" SERIAL,
  "combo_name" VARCHAR(255) NOT NULL,
  "products" JSONB NOT NULL,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "content_pdf" (
  "id" VARCHAR(50) NOT NULL,
  "title" VARCHAR(255) NOT NULL,
  "filename" VARCHAR(255) NOT NULL,
  "category" VARCHAR(100) NOT NULL,
  "upload_date" VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS "main_database" (
  "sr_no" SERIAL,
  "member_id" VARCHAR(100) NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "order_date" VARCHAR(100) NOT NULL,
  "pv" VARCHAR(50) DEFAULT '0'::character varying,
  "amount" VARCHAR(50) DEFAULT '0'::character varying,
  "tracking" VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS "orders_master" (
  "id" SERIAL,
  "order_date" VARCHAR(255),
  "member_id" VARCHAR(100),
  "name" VARCHAR(255),
  "pv" VARCHAR(50),
  "amount" VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS "parcel_tracking_status" (
  "id" SERIAL,
  "article_number" VARCHAR(100) NOT NULL,
  "article_type" VARCHAR(100),
  "booked_at" VARCHAR(255),
  "booked_on" VARCHAR(100),
  "destination" VARCHAR(255),
  "status" VARCHAR(100),
  "last_event" TEXT,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "pending_entries" (
  "id" SERIAL,
  "tracking" VARCHAR(100) NOT NULL,
  "weight" VARCHAR(50),
  "length" VARCHAR(50),
  "breadth" VARCHAR(50),
  "height" VARCHAR(50),
  "name" VARCHAR(255),
  "mobile" VARCHAR(20),
  "pincode" VARCHAR(20),
  "city" VARCHAR(100),
  "state" VARCHAR(100),
  "address" TEXT,
  "member_id" VARCHAR(100) DEFAULT ''::character varying,
  "order_date" VARCHAR(100) DEFAULT ''::character varying,
  "pv" VARCHAR(50) DEFAULT '0'::character varying,
  "amount" VARCHAR(50) DEFAULT '0'::character varying
);

CREATE TABLE IF NOT EXISTS "pincodes" (
  "id" SERIAL,
  "pincode" VARCHAR(10) NOT NULL,
  "address" TEXT,
  "city" VARCHAR(100),
  "state" VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS "query_tickets" (
  "id" SERIAL,
  "member_id" VARCHAR(100) NOT NULL,
  "subject" VARCHAR(255) NOT NULL,
  "description" TEXT NOT NULL,
  "contact_no" VARCHAR(20) NOT NULL,
  "status" VARCHAR(50) DEFAULT 'PENDING'::character varying,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "name" VARCHAR(255),
  "admin_reply" TEXT,
  "replied_at" TIMESTAMP
);

