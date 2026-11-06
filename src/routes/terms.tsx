import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/LegalPage";
import { LEGAL_CONFIG } from "@/lib/legal";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service - OpenLedgerApp" },
      {
        name: "description",
        content: `Terms of Service for OpenLedgerApp, operated by ${LEGAL_CONFIG.operatorName}.`,
      },
      { property: "og:title", content: "Terms of Service - OpenLedgerApp" },
      {
        property: "og:description",
        content: "The terms that govern access to and use of OpenLedgerApp.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TermsPage,
});

function Mail({ email }: { email: string }) {
  return (
    <a className="text-primary underline" href={`mailto:${email}`}>
      {email}
    </a>
  );
}

function TermsPage() {
  const op = LEGAL_CONFIG.operatorName;
  return (
    <LegalPage
      title="Terms of Service"
      summary="These Terms govern your access to and use of OpenLedgerApp. Your organization's records stay yours; we act as their custodian."
    >
      <section>
        <h2>1. Acceptance of Terms</h2>
        <p>
          These Terms of Service (“Terms”) govern your access to and use of OpenLedgerApp
          (“Application” or “Service”), including its website, features, functionality, and related
          services.
        </p>
        <p>The Application is operated by {op} (“we,” “us,” or “our”).</p>
        <p>
          By creating an account, accessing, or using the Application, you acknowledge that you have
          read and agree to these Terms and the accompanying Privacy Policy.
        </p>
        <p>
          If you are accessing the Application on behalf of an organization, you represent that you
          are authorized to accept these Terms on behalf of that organization.
        </p>
        <p>If you do not agree to these Terms, you must discontinue use of the Application.</p>
      </section>

      <section>
        <h2>2. Definitions</h2>
        <ul>
          <li>
            <strong>Application or Service:</strong> OpenLedgerApp and all associated software,
            features, services, and functionality.
          </li>
          <li>
            <strong>Operating Organization:</strong> {op}, the organization legally responsible for
            operating and maintaining the Application.
          </li>
          <li>
            <strong>Customer Organization:</strong> A nonprofit, club, board, association, small
            business, or other organization that uses the Application to manage its books and
            records.
          </li>
          <li>
            <strong>User:</strong> An individual authorized to access the Application.
          </li>
          <li>
            <strong>Organization Data:</strong> Information, records, documents, accounts,
            transactions, bank statements, attachments, budgets, funds, reconciliations, reports,
            and other content submitted to or maintained within the Application.
          </li>
          <li>
            <strong>User Content:</strong> Information and materials submitted, uploaded, created,
            or otherwise provided by a User.
          </li>
          <li>
            <strong>Personal Information:</strong> Information relating to an identified or
            identifiable individual.
          </li>
        </ul>
      </section>

      <section>
        <h2>3. Description of Services</h2>
        <p>
          OpenLedgerApp is designed to help organizations keep their books, including accounts,
          transactions, bank imports, reconciliations, budgets, funds, projects, and financial
          reports.
        </p>
        <p>
          The Application provides tools for organizations and their authorized users to create,
          maintain, and access organizational records.
        </p>
        <p>
          We may add, modify, improve, or discontinue features as necessary to maintain and develop
          the Service. We will make reasonable efforts to communicate material changes that
          substantially affect the availability or functionality of the Service.
        </p>
        <p>
          If you install or operate OpenLedgerApp yourself (including the desktop edition or a
          self-hosted deployment), you control that installation, its security, backups, and
          compliance. Open-source software rights are governed by the license included with the
          source code; these Terms do not replace that license.
        </p>
      </section>

      <section>
        <h2>4. Accounts and Access</h2>
        <p>Users must provide accurate information when creating or maintaining an account.</p>
        <p>
          Users are responsible for maintaining the confidentiality of their login credentials and
          for activity conducted through their accounts.
        </p>
        <p>
          Users must promptly notify us if they believe their account has been compromised or
          accessed without authorization.
        </p>
        <p>
          Customer Organizations are responsible for determining which individuals are authorized to
          access their organizational information and for assigning appropriate permissions.
        </p>
        <p>
          We may restrict, suspend, or revoke access when reasonably necessary to protect the
          Application, its Users, Customer Organizations, or the security of information maintained
          within the Service.
        </p>
        <p>
          We reserve the right to verify account ownership and authorization when responding to
          access, modification, or deletion requests.
        </p>
      </section>

      <section>
        <h2>5. Data Ownership and Custodianship</h2>
        <p>
          Customer Organizations and Users retain ownership of the information, records, documents,
          and other content they submit to or create within OpenLedgerApp, subject to any rights
          belonging to third parties.
        </p>
        <p>
          The Operating Organization acts as a custodian of Customer Organization Data. We do not
          claim ownership of Customer Organization Data or User Content merely because it is stored,
          processed, or maintained within the Application.
        </p>
        <p>
          Our role is limited to providing the technical infrastructure and services necessary to
          store, maintain, process, secure, and make that information available to authorized Users.
        </p>
        <p>
          We do not acquire independent rights to exploit, commercialize, publish, sell, or
          otherwise use Customer Organization Data for purposes unrelated to providing the Service,
          except where authorized by the Customer Organization or permitted or required by
          applicable law.
        </p>
        <p>
          Users and Customer Organizations are responsible for ensuring that they have the necessary
          rights and permissions to submit information to the Application.
        </p>
        <p>
          Nothing in these Terms transfers intellectual property ownership in User Content or
          Organization Data to the Operating Organization.
        </p>
      </section>

      <section>
        <h2>6. Limited License to Operate the Service</h2>
        <p>
          By submitting information to OpenLedgerApp, you grant the Operating Organization a
          limited, non-exclusive, non-transferable license to host, store, reproduce, transmit,
          display, and process that information solely as reasonably necessary to:
        </p>
        <ul>
          <li>Provide the features and functionality of the Application.</li>
          <li>
            Make information available to authorized Users within the appropriate organization.
          </li>
          <li>Maintain, troubleshoot, support, and secure the Application.</li>
          <li>Create and maintain backups and operational records as reasonably necessary.</li>
          <li>Comply with applicable legal obligations.</li>
        </ul>
        <p>
          This license terminates when the relevant information is deleted or the Service is
          discontinued, except to the extent that continued retention or processing is necessary or
          permitted under these Terms or applicable law.
        </p>
      </section>

      <section>
        <h2>7. Acceptable Use</h2>
        <p>
          Users agree to use the Application only for lawful purposes and in accordance with these
          Terms. Users may not:
        </p>
        <ul>
          <li>Use the Application to violate federal, state, or local laws or regulations.</li>
          <li>
            Attempt to gain unauthorized access to another User's account, organizational records,
            or restricted functionality.
          </li>
          <li>Interfere with the availability, integrity, or security of the Application.</li>
          <li>Upload malicious software, harmful code, or unauthorized content.</li>
          <li>
            Use the Application to harass, threaten, defraud, or otherwise harm another person.
          </li>
          <li>Attempt to circumvent authentication, authorization, or other security controls.</li>
          <li>
            Access, collect, or disclose another organization's information without authorization.
          </li>
          <li>
            Reverse engineer, exploit, or interfere with the Application except where such
            restrictions are prohibited by applicable law or permitted by the open-source license.
          </li>
        </ul>
      </section>

      <section>
        <h2>8. Customer Organization Responsibilities</h2>
        <p>
          Customer Organizations are responsible for their internal governance, financial
          management, organizational decisions, and the accuracy of the information they maintain
          within the Application.
        </p>
        <p>
          Customer Organizations are responsible for determining who may access their records and
          for managing User permissions.
        </p>
        <p>
          Customer Organizations must ensure that information submitted to the Application is
          collected and processed in accordance with applicable law and their own organizational
          policies.
        </p>
        <p>
          The Operating Organization does not independently verify the accuracy of transactions,
          balances, reconciliations, budgets, reports, or filings recorded within or produced by the
          Application.
        </p>
        <p>
          Customer Organizations remain responsible for maintaining any records they are
          independently required to retain under applicable law.
        </p>
      </section>

      <section>
        <h2>9. Privacy and Data Handling</h2>
        <p>
          Your use of OpenLedgerApp is also governed by our Privacy Policy, which is incorporated
          into these Terms by reference.
        </p>
        <p>We do not sell Customer Organization Data or Personal Information.</p>
        <p>
          We do not use Customer Organization Data or Personal Information for advertising, targeted
          marketing, or unrelated commercial purposes.
        </p>
        <p>
          We do not operate advertising networks within the Application or permit advertising
          providers to use Customer Organization Data for advertising purposes.
        </p>
        <p>
          Information is processed only as necessary to provide and maintain the Service, protect
          its security, support authorized Users, or comply with applicable law.
        </p>
        <p>
          Limited information may be processed by hosting, infrastructure, and other service
          providers acting on our behalf to operate the Application. Such processing is subject to
          appropriate contractual and operational safeguards.
        </p>
      </section>

      <section>
        <h2>10. Third-Party Services</h2>
        <p>
          The Application may rely on third-party service providers for hosting, infrastructure,
          authentication, email delivery, storage, security, optional AI-assisted document reading,
          and other operational functions.
        </p>
        <p>
          These providers may process limited information as necessary to perform services on our
          behalf.
        </p>
        <p>
          We do not authorize these providers to independently sell Customer Organization Data or
          use it for their own advertising or marketing purposes.
        </p>
        <p>
          Third-party services that Users independently access or integrate with may be subject to
          separate terms and privacy policies.
        </p>
        <p>
          We are not responsible for the independent privacy or security practices of third-party
          services outside our control.
        </p>
      </section>

      <section>
        <h2>11. Compliance with Applicable Law and Legal Requests</h2>
        <p>
          The Application is operated in accordance with applicable federal, state, and local laws
          and regulations.
        </p>
        <p>
          Nothing in these Terms or our Privacy Policy prevents or restricts the Operating
          Organization from complying with a valid legal obligation or lawful governmental request.
        </p>
        <p>We may preserve, access, use, or disclose information when reasonably necessary to:</p>
        <ul>
          <li>Comply with applicable laws, regulations, and legally enforceable obligations.</li>
          <li>
            Respond to valid subpoenas, warrants, court orders, or other lawful governmental
            demands.
          </li>
          <li>Cooperate with lawful investigations or regulatory proceedings.</li>
          <li>
            Protect the rights, property, security, and safety of the Operating Organization,
            Customer Organizations, Users, or the public, to the extent permitted by applicable law.
          </li>
        </ul>
        <p>
          Where legally permitted, we will make reasonable efforts to limit disclosures to the
          information required by the applicable legal obligation.
        </p>
        <p>
          Where legally permitted and reasonably practicable, we may notify the affected Customer
          Organization of a legal request before disclosing information. We do not guarantee
          notification where prohibited by law or where notification would create an unacceptable
          legal or security risk.
        </p>
        <p>
          We will not voluntarily provide unrestricted access to Customer Organization Data merely
          because a governmental entity requests it. Requests will be evaluated in accordance with
          applicable law.
        </p>
      </section>

      <section>
        <h2>12. Service Availability and Changes</h2>
        <p>
          We make reasonable efforts to maintain the availability and reliability of OpenLedgerApp
          but do not guarantee uninterrupted or error-free operation.
        </p>
        <p>
          The Service may be temporarily unavailable due to maintenance, infrastructure failures,
          security incidents, third-party service disruptions, or circumstances beyond our
          reasonable control.
        </p>
        <p>
          We may modify, update, or discontinue portions of the Application as necessary for
          operational, technical, security, or legal reasons.
        </p>
        <p>
          We will make reasonable efforts to provide notice of material changes when practicable.
        </p>
      </section>

      <section>
        <h2>13. Information Security</h2>
        <p>
          We implement reasonable administrative, technical, and organizational safeguards designed
          to protect information maintained within the Application.
        </p>
        <p>
          These safeguards are intended to prevent unauthorized access, alteration, disclosure,
          loss, or destruction of information.
        </p>
        <p>
          No electronic storage system, transmission method, or security measure can guarantee
          absolute security.
        </p>
        <p>
          Users and Customer Organizations are responsible for maintaining appropriate account
          security and protecting their own devices and credentials.
        </p>
        <p>
          We will address security incidents in accordance with applicable legal requirements and
          our operational security procedures.
        </p>
      </section>

      <section>
        <h2>14. Suspension and Termination</h2>
        <p>Users may discontinue using the Application at any time.</p>
        <p>
          Customer Organizations may request closure of their organizational accounts in accordance
          with the Application's available account-management procedures.
        </p>
        <p>
          We may suspend or terminate access when reasonably necessary due to violations of these
          Terms, security concerns, unlawful activity, legal obligations, or discontinuation of the
          Service.
        </p>
        <p>
          Upon termination, access to organizational information may be restricted and information
          may be scheduled for deletion in accordance with our Privacy Policy and applicable
          retention requirements.
        </p>
        <p>
          Termination does not eliminate obligations that arose before termination or obligations
          that survive under applicable law.
        </p>
      </section>

      <section>
        <h2>15. Data Deletion and Retention</h2>
        <p>
          Customer Organizations and authorized Users may request deletion of information associated
          with their accounts, subject to their permissions and applicable law.
        </p>
        <p>
          When an account is closed or deletion is requested, we will take reasonable steps to
          delete the associated information from active production systems in accordance with our
          established deletion procedures.
        </p>
        <p>
          Certain information may be retained when required by law, necessary to resolve disputes,
          protect security, prevent fraud, or establish or defend legal claims.
        </p>
        <p>
          Information contained in backups may remain temporarily until those backups are
          overwritten or expire through the normal backup-retention process.
        </p>
        <p>
          Information retained for legal or operational reasons will not be used for unrelated
          commercial purposes.
        </p>
        <p>
          Where information cannot immediately be deleted due to legal requirements or technical
          limitations, we will limit its continued processing to the applicable retention purpose.
        </p>
      </section>

      <section>
        <h2>16. Disclaimer of Warranties</h2>
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE APPLICATION IS PROVIDED ON AN “AS
          IS” AND “AS AVAILABLE” BASIS.
        </p>
        <p>
          We make no guarantees that the Application will always be available, uninterrupted,
          error-free, or compatible with every device or environment.
        </p>
        <p>
          We do not guarantee that information entered by Users or Customer Organizations, or
          imports, classifications, balances, and reports produced from it, are accurate, complete,
          or legally sufficient.
        </p>
        <p>
          The Application is an administrative and bookkeeping tool. It does not provide legal,
          financial, accounting, tax, or professional advice.
        </p>
        <p>
          Nothing in these Terms excludes warranties or rights that cannot legally be excluded under
          applicable law.
        </p>
      </section>

      <section>
        <h2>17. Limitation of Liability</h2>
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE OPERATING ORGANIZATION SHALL NOT BE
          LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES
          ARISING FROM OR RELATED TO THE USE OF THE APPLICATION.
        </p>
        <p>
          This includes, where legally permitted, loss of profits, business interruption, loss of
          goodwill, loss of anticipated savings, or loss of data.
        </p>
        <p>
          The Operating Organization shall not be responsible for decisions made by Customer
          Organizations or Users based on information maintained within the Application.
        </p>
        <p>
          Nothing in these Terms limits liability that cannot legally be limited or excluded under
          applicable law.
        </p>
      </section>

      <section>
        <h2>18. Indemnification</h2>
        <p>
          To the extent permitted by applicable law, Users and Customer Organizations agree to be
          responsible for claims arising from their unlawful use of the Application, unauthorized
          submission of information, infringement of third-party rights, or material violation of
          these Terms.
        </p>
        <p>
          Nothing in this section requires a User to indemnify the Operating Organization for the
          Operating Organization's own unlawful conduct or liability that cannot legally be
          transferred.
        </p>
      </section>

      <section>
        <h2>19. Changes to These Terms</h2>
        <p>
          We may update these Terms from time to time to reflect changes in the Application, our
          operational practices, or applicable law.
        </p>
        <p>
          The current version will be made available within the Application, together with its
          effective or last-updated date.
        </p>
        <p>
          Where required by applicable law, we will provide notice of material changes or obtain
          renewed consent.
        </p>
        <p>
          Continued use of the Application after updated Terms become effective constitutes
          acceptance where permitted by applicable law.
        </p>
      </section>

      <section>
        <h2>20. Governing Law and Jurisdiction</h2>
        <p>
          These Terms shall be governed by the laws of the {LEGAL_CONFIG.jurisdiction} and
          applicable federal law, without regard to conflict-of-law principles, subject to any
          mandatory laws that apply to a particular User or Customer Organization.
        </p>
        <p>
          Any dispute arising from these Terms shall be brought before a court of competent
          jurisdiction, subject to applicable law and any non-waivable legal rights.
        </p>
        <p>Nothing in this section limits rights or remedies that cannot legally be waived.</p>
      </section>

      <section>
        <h2>21. Severability</h2>
        <p>
          If any provision of these Terms is determined to be invalid, unlawful, or unenforceable,
          the remaining provisions shall continue in effect to the fullest extent permitted by law.
        </p>
        <p>
          Any invalid or unenforceable provision shall be interpreted or modified to the minimum
          extent necessary to make it enforceable, where legally permitted.
        </p>
      </section>

      <section>
        <h2>22. Contact Information</h2>
        <p>OpenLedgerApp is operated by {op}.</p>
        <ul>
          <li>
            Legal inquiries: <Mail email={LEGAL_CONFIG.privacyEmail} />
          </li>
          <li>
            Technical support: <Mail email={LEGAL_CONFIG.supportEmail} />
          </li>
        </ul>
        <p>
          Please include sufficient information to identify your organization and describe your
          inquiry.
        </p>
      </section>
    </LegalPage>
  );
}
