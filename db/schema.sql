CREATE TABLE "graph_revisions" (
	"graph_id" bigint,
	"revision_id" bigint,
	"federation_version" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "graph_revisions_pkey" PRIMARY KEY("graph_id","revision_id")
);

CREATE TABLE "graphs" (
	"id" bigserial PRIMARY KEY,
	"external_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"current_revision_id" bigint NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);

CREATE TABLE "subgraph_revisions" (
	"subgraph_id" bigint,
	"revision_id" bigint,
	"routing_url" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "subgraph_revisions_pkey" PRIMARY KEY("subgraph_id","revision_id")
);

CREATE TABLE "subgraphs" (
	"id" bigserial PRIMARY KEY,
	"external_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"graph_id" bigint NOT NULL,
	"slug" text NOT NULL,
	"current_revision_id" bigint NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);

CREATE UNIQUE INDEX "graphs_external_id_uniq" ON "graphs" ("external_id");
CREATE UNIQUE INDEX "graphs_active_slug_uniq" ON "graphs" ("slug") WHERE "deleted_at" IS NULL;
CREATE INDEX "graphs_active_slug_idx" ON "graphs" ("slug") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "subgraphs_external_id_uniq" ON "subgraphs" ("external_id");
CREATE UNIQUE INDEX "subgraphs_graph_active_slug_uniq" ON "subgraphs" ("graph_id","slug") WHERE "deleted_at" IS NULL;
CREATE INDEX "subgraphs_graph_active_slug_idx" ON "subgraphs" ("graph_id","slug") WHERE "deleted_at" IS NULL;
ALTER TABLE "graph_revisions" ADD CONSTRAINT "graph_revisions_graph_fk" FOREIGN KEY ("graph_id") REFERENCES "graphs"("id");
ALTER TABLE "subgraph_revisions" ADD CONSTRAINT "subgraph_revisions_subgraph_fk" FOREIGN KEY ("subgraph_id") REFERENCES "subgraphs"("id");
ALTER TABLE "subgraphs" ADD CONSTRAINT "subgraphs_graph_fk" FOREIGN KEY ("graph_id") REFERENCES "graphs"("id");
