-- Language support: spoken languages on the candidate's Profile (free text,
-- extracted from the CV) and required languages on each Job (normalised to
-- "de"/"en", emitted by the scoring AI). Both default to empty so existing
-- rows stay valid; the application interprets an empty Job.requiredLanguages
-- as "English is sufficient" per the German-market product rule.
ALTER TABLE "Profile" ADD COLUMN "languages" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "Job" ADD COLUMN "requiredLanguages" TEXT[] NOT NULL DEFAULT '{}';
