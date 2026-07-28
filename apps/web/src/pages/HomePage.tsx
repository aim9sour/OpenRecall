import type { SectionSummary } from "@openrecall/contracts";
import { useEffect, useRef } from "react";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { useI18n } from "../app/I18nProvider.js";

export interface CreateSectionActionData {
  readonly errorMessageKeys?: readonly string[];
}

export function HomePage() {
  const sections = useLoaderData() as SectionSummary[];
  const actionData = useActionData() as CreateSectionActionData | undefined;
  const navigation = useNavigation();
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    if ((actionData?.errorMessageKeys?.length ?? 0) > 0) {
      errorSummaryRef.current?.focus();
    }
  }, [actionData]);

  return (
    <>
      <h1 data-route-heading tabIndex={-1}>
        {t("home.title")}
      </h1>

      <section aria-labelledby="create-section-heading" className="panel">
        <h2 id="create-section-heading">{t("home.createHeading")}</h2>
        {actionData?.errorMessageKeys !== undefined &&
          actionData.errorMessageKeys.length > 0 && (
            <div
              className="error-summary"
              ref={errorSummaryRef}
              role="alert"
              tabIndex={-1}
            >
              <h3>{t("error.summary")}</h3>
              <ul>
                {actionData.errorMessageKeys.map((messageKey) => (
                  <li key={messageKey}>{t(messageKey)}</li>
                ))}
              </ul>
            </div>
          )}
        <Form method="post">
          <label htmlFor="section-name">{t("section.name")}</label>
          <input
            id="section-name"
            name="name"
            type="text"
            maxLength={200}
            required
          />
          <button
            type="submit"
            disabled={navigation.state === "submitting"}
          >
            {navigation.state === "submitting"
              ? t("form.submitting")
              : t("section.create")}
          </button>
        </Form>
      </section>

      <section aria-labelledby="sections-heading">
        <h2 id="sections-heading">{t("home.sectionsHeading")}</h2>
        {sections.length === 0 ? (
          <p>{t("home.empty")}</p>
        ) : (
          <ul className="section-grid">
            {sections.map((section) => {
              const reviewDescriptionId = `review-unavailable-${section.id}`;
              return (
                <li key={section.id} className="panel">
                  <article>
                    <h3>
                      <Link to={`/sections/${section.id}`}>
                        {section.name}
                      </Link>
                    </h3>
                    <dl className="statistics">
                      <div>
                        <dt>{t("stats.total")}</dt>
                        <dd>{section.counts.total}</dd>
                      </div>
                      <div>
                        <dt>{t("stats.new")}</dt>
                        <dd>{section.counts.new}</dd>
                      </div>
                      <div>
                        <dt>{t("stats.due")}</dt>
                        <dd>{section.counts.dueNow}</dd>
                      </div>
                    </dl>
                    <button
                      type="button"
                      disabled
                      aria-describedby={reviewDescriptionId}
                    >
                      {t("section.startReview")}
                    </button>
                    <p id={reviewDescriptionId}>
                      {t("section.reviewUnavailable")}
                    </p>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
