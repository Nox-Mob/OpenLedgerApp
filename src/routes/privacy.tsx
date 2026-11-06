import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/LegalPage";
import { LEGAL_CONFIG } from "@/lib/legal";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy - OpenLedgerApp" },
      {
        name: "description",
        content: `How ${LEGAL_CONFIG.operatorName} handles information entrusted to OpenLedgerApp.`,
      },
      { property: "og:title", content: "Privacy Policy - OpenLedgerApp" },
      {
        property: "og:description",
        content:
          "Your information belongs to you. We do not sell it or use it for advertising or marketing.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PrivacyPage,
});

function Mail({ email }: { email: string }) {
  return (
    <a className="text-primary underline" href={`mailto:${email}`}>
      {email}
    </a>
  );
}

function PrivacyPage() {
  const op = LEGAL_CONFIG.operatorName;
  return (
    <LegalPage
      title="Privacy Policy"
      summary="Your information belongs to you. We act as its custodian, and we do not sell it or use it for advertising, targeted marketing, or unrelated commercial purposes."
    >
      <section>
        <h2>1. Introduction</h2>
        <p>OpenLedgerApp is operated by {op} (“we,” “us,” or “our”).</p>
        <p>
          We recognize that the information entrusted to OpenLedgerApp may include sensitive
          financial records, bank statements, personal information, donor and vendor details,
          membership details, and internal communications.
        </p>
        <p>
          We believe that the information maintained within the Application belongs to the
          individuals and organizations that provide it, subject to applicable third-party rights.
        </p>
        <p>
          Our role is to act as a custodian of that information and to provide the technology
          necessary to store, manage, and make it available to authorized Users.
        </p>
        <p>
          We do not sell personal information or organizational data. We do not use information for
          advertising, targeted marketing, or unrelated commercial purposes.
        </p>
        <p>
          This Privacy Policy describes our information-handling practices and the rights and
          responsibilities associated with using the Application.
        </p>
      </section>

      <section>
        <h2>2. Scope and Roles</h2>
        <p>
          This Policy applies to individuals who access or use the hosted OpenLedgerApp service,
          including representatives, officers, board members, treasurers, bookkeepers, employees,
          volunteers, and other authorized Users. It does not govern self-hosted or desktop
          installations that we do not operate; whoever operates those installations controls their
          data practices.
        </p>
        <p>
          A Customer Organization generally determines what organizational information is submitted
          to the Application, who may access it, and how it is used for that organization's
          activities.
        </p>
        <p>
          Depending on the nature of the relationship and applicable law, the Customer Organization
          may act as the business responsible for the information, while the Operating Organization
          acts as a service provider or custodian.
        </p>
        <p>
          The Operating Organization may independently determine limited processing necessary to
          administer accounts, maintain security, operate the Service, and comply with legal
          obligations.
        </p>
        <p>
          Customer Organizations may maintain separate privacy policies or notices governing their
          own organizational activities. Users should consult their organization regarding
          questions about the collection or use of organizational information.
        </p>
      </section>

      <section>
        <h2>3. Information We Collect</h2>
        <p>
          We collect and process only information that is provided to us or reasonably necessary to
          operate, secure, and maintain the Application. Depending on how the Application is used,
          information may include the following categories:
        </p>
        <h3>3.1 Account Information</h3>
        <ul>
          <li>
            Name, email address, account identifiers, authentication information (including
            multi-factor authentication settings), and other details provided during registration or
            account management.
          </li>
          <li>Organization membership, role, permissions, and account status.</li>
          <li>
            The version and time you accepted these Terms, this Privacy Policy, and other notices.
          </li>
        </ul>
        <h3>3.2 Organizational Information</h3>
        <ul>
          <li>Organization names, contact information, settings, and organizational details.</li>
          <li>
            Chart of accounts, transactions, journal entries, imported bank statements,
            reconciliations, budgets, funds, projects, pledges, templates, reports, and audit
            history.
          </li>
          <li>Documents, files, attachments, and other information submitted by authorized Users.</li>
        </ul>
        <h3>3.3 User-Provided Information</h3>
        <ul>
          <li>
            Information entered into forms, submitted through application features, uploaded as
            documents, or otherwise provided by Users.
          </li>
          <li>
            Information about third parties (such as payees, vendors, or donors) that a Customer
            Organization or User chooses to submit to the Application.
          </li>
          <li>
            Users and Customer Organizations are responsible for ensuring that they have an
            appropriate legal basis and authorization to provide information about other
            individuals.
          </li>
        </ul>
        <h3>3.4 Technical and Security Information</h3>
        <p>
          Limited technical information may be processed automatically to operate and secure the
          Application. This may include IP addresses, browser type, device information, session
          identifiers, authentication events, timestamps, application errors, and security-related
          activity.
        </p>
        <p>
          Such information is used for authentication, troubleshooting, fraud prevention, security
          monitoring, and maintaining reliable service.
        </p>
        <h3>3.5 Support and Communications</h3>
        <p>
          Information provided when contacting technical support, reporting problems, submitting
          inquiries, or communicating with the Operating Organization. This may include your contact
          details, the contents of your communication, and relevant information necessary to
          investigate and resolve your inquiry.
        </p>
      </section>

      <section>
        <h2>4. How We Use Information</h2>
        <p>
          We use information only for purposes reasonably related to providing, maintaining,
          securing, and supporting OpenLedgerApp. These purposes include:
        </p>
        <ul>
          <li>Creating and administering User accounts.</li>
          <li>Authenticating Users and enforcing access permissions.</li>
          <li>Storing and displaying organizational records and documents.</li>
          <li>
            Providing bookkeeping, import, reconciliation, budgeting, fund-tracking, and reporting
            functionality.
          </li>
          <li>Maintaining system availability and performance.</li>
          <li>Troubleshooting technical problems and responding to support requests.</li>
          <li>
            Protecting the Application against unauthorized access, misuse, and security threats.
          </li>
          <li>Maintaining backups and operational records.</li>
          <li>Complying with applicable federal, state, and local laws.</li>
        </ul>
        <p>
          We do not use Customer Organization Data or Personal Information for unrelated commercial
          purposes.
        </p>
      </section>

      <section>
        <h2>5. No Sale, Marketing, or Advertising</h2>
        <p>
          We do not sell, rent, lease, license, or exchange Personal Information or Customer
          Organization Data for monetary or other valuable consideration.
        </p>
        <p>We do not sell user information to data brokers or advertising networks.</p>
        <p>
          We do not use Customer Organization Data or Personal Information to create advertising
          profiles, deliver targeted advertisements, or support third-party advertising campaigns.
        </p>
        <p>We do not display third-party advertisements within OpenLedgerApp.</p>
        <p>
          We do not use information maintained within the Application for independent marketing,
          promotional campaigns, or unrelated commercial exploitation.
        </p>
        <p>
          We do not use organizational records or User Content to develop advertising products or
          marketing profiles.
        </p>
        <p>
          We may send communications necessary to operate the Service, including account
          verification, password recovery, security notifications, technical announcements, and
          legally required notices. These are operational communications, not marketing
          communications.
        </p>
        <p>
          We will not repurpose operational communications as a channel for unrelated promotional
          messaging.
        </p>
      </section>

      <section>
        <h2>6. Service Providers and Third-Party Processing</h2>
        <p>
          We may use carefully selected third-party service providers to operate and maintain
          OpenLedgerApp. These providers may include infrastructure hosting providers, database
          providers, authentication services, email delivery providers, storage providers, and
          security services.
        </p>
        <p>
          Such providers may process information only to the extent reasonably necessary to perform
          services on our behalf or as otherwise permitted by applicable law.
        </p>
        <p>
          We do not authorize service providers to sell Customer Organization Data or use it for
          their own independent advertising or marketing purposes.
        </p>
        <p>
          Where appropriate, we use contractual, technical, and organizational safeguards designed
          to protect information processed by these providers.
        </p>
        <p>
          We may update or replace service providers as operational needs change. Material changes
          to our information-processing practices will be reflected in this Policy where
          appropriate. A current list of relevant service providers and their processing purposes
          is available on request where required by applicable law or agreement.
        </p>
        <h3>Optional AI-assisted PDF reading</h3>
        <p>
          AI-assisted PDF statement reading is optional and off until an organization administrator
          enables it. Each upload requires a separate acknowledgement. When you choose this feature,
          the uploaded statement is sent to our AI processing provider solely to extract the
          requested transaction information. AI output may be wrong and must be reviewed before
          posting.
        </p>
      </section>

      <section>
        <h2>7. Cookies and Similar Technologies</h2>
        <p>
          OpenLedgerApp may use cookies or similar technologies to provide a reliable and convenient
          user experience. These technologies may be used for:
        </p>
        <ul>
          <li>Maintaining authenticated sessions and keeping Users signed in.</li>
          <li>Remembering preferences and application settings.</li>
          <li>Maintaining security and preventing unauthorized access.</li>
          <li>Supporting essential application functionality.</li>
        </ul>
        <p>
          We do not use cookies for advertising, targeted advertising, cross-site advertising
          tracking, or the sale of Personal Information.
        </p>
        <p>We do not authorize advertising networks to place tracking cookies within the Application.</p>
        <p>
          Where applicable law requires consent for non-essential cookies or similar technologies,
          we will obtain that consent before using them.
        </p>
        <p>
          Users may be able to manage or disable cookies through their browser settings. Disabling
          certain cookies may affect the availability or functionality of some Application features.
        </p>
      </section>

      <section>
        <h2>8. Access to Information</h2>
        <p>
          Access to organizational information is restricted according to the permissions and roles
          established within the Application.
        </p>
        <p>
          Customer Organizations are responsible for determining which Users may access their
          organizational information.
        </p>
        <p>The Operating Organization may access information when reasonably necessary to:</p>
        <ul>
          <li>Provide technical support requested by an authorized User.</li>
          <li>Troubleshoot or resolve application issues.</li>
          <li>Maintain or restore system functionality.</li>
          <li>Investigate suspected unauthorized access, fraud, or security incidents.</li>
          <li>Perform necessary maintenance, backups, or system administration.</li>
          <li>Comply with applicable legal obligations.</li>
        </ul>
        <p>
          Access by personnel is limited to individuals with an operational need and is subject to
          appropriate administrative and technical safeguards.
        </p>
        <p>We do not routinely review or monitor organizational content for unrelated purposes.</p>
      </section>

      <section>
        <h2>9. Legal Requirements and Government Requests</h2>
        <p>
          We operate in accordance with applicable federal, state, and local laws and regulations.
        </p>
        <p>
          We may preserve, access, process, or disclose information when required or authorized by
          applicable law. Circumstances may include:
        </p>
        <ul>
          <li>Valid subpoenas and court orders.</li>
          <li>Search warrants and other legally enforceable demands.</li>
          <li>Regulatory requirements and lawful governmental investigations.</li>
          <li>Legal obligations to preserve or produce records.</li>
          <li>Other legally authorized requests or disclosures.</li>
        </ul>
        <p>
          We will not treat an informal request as automatically authorizing unrestricted access to
          Customer Organization Data.
        </p>
        <p>
          Where legally permitted, we will make reasonable efforts to verify the legal basis and
          scope of a request and limit any disclosure to the information reasonably required.
        </p>
        <p>
          Where legally permitted and reasonably practicable, we may notify the affected Customer
          Organization before disclosing information.
        </p>
        <p>
          We cannot guarantee notification where prohibited by law, restricted by a valid order, or
          where notification would create an unacceptable legal or security risk.
        </p>
        <p>
          Nothing in this Policy prevents us from complying with a lawful obligation or valid legal
          process.
        </p>
      </section>

      <section>
        <h2>10. Information Security</h2>
        <p>
          We implement reasonable administrative, technical, and organizational safeguards designed
          to protect information maintained within OpenLedgerApp. Depending on the relevant system
          and functionality, safeguards may include:
        </p>
        <ul>
          <li>Authentication and authorization controls, including optional multi-factor authentication.</li>
          <li>Role-based access restrictions.</li>
          <li>Secure communication and data transmission.</li>
          <li>Database access controls and organization-level data separation.</li>
          <li>System monitoring, security logging, and audit history.</li>
          <li>Backup and recovery procedures.</li>
          <li>Software maintenance and security updates.</li>
        </ul>
        <p>We periodically review our security practices and make improvements as appropriate.</p>
        <p>
          No security system or method of electronic transmission can guarantee absolute protection.
          We cannot guarantee that unauthorized access, data loss, or other security incidents will
          never occur.
        </p>
        <p>
          We will address security incidents in accordance with applicable law and our established
          incident-response procedures.
        </p>
      </section>

      <section>
        <h2>11. Data Retention</h2>
        <p>
          We retain information only for as long as reasonably necessary to provide the Service,
          fulfill operational requirements, and comply with applicable legal obligations.
        </p>
        <p>
          Customer Organization Data is generally maintained while the applicable organization
          maintains an active account or otherwise requires access to the information.
        </p>
        <p>
          Certain technical, security, and operational records may be retained for limited periods
          after account closure where necessary for security, troubleshooting, fraud prevention, or
          legal compliance.
        </p>
        <p>
          Information may also be retained where required to establish, exercise, or defend legal
          claims or to satisfy applicable recordkeeping obligations.
        </p>
        <p>
          We do not retain information indefinitely for advertising, marketing, data brokerage, or
          unrelated commercial purposes.
        </p>
      </section>

      <section>
        <h2>12. Account Closure and Data Deletion</h2>
        <p>
          We recognize that Customer Organizations and Users retain ownership of their information
          and should be able to discontinue using the Application without surrendering ownership of
          their records.
        </p>
        <p>
          Authorized Users and Customer Organizations may request the deletion of information
          associated with their accounts, subject to applicable permissions and legal requirements.
        </p>
        <p>Account closure or a valid deletion request will initiate the applicable deletion process.</p>
        <p>
          We will take reasonable steps to remove the requested information from active production
          systems in accordance with our established deletion procedures.
        </p>
        <p>
          Certain information may remain temporarily in backups, disaster-recovery systems, or other
          protected archival storage until those systems reach their normal expiration or
          replacement cycles.
        </p>
        <p>
          We may retain information where required by law or where reasonably necessary to address
          security matters, prevent fraud, resolve disputes, or establish or defend legal claims.
        </p>
        <p>
          Information retained under these exceptions will be restricted to the purpose requiring
          retention and will not be used for unrelated commercial purposes.
        </p>
        <p>
          Deletion requests may be subject to verification of identity, account ownership, and
          organizational authority.
        </p>
        <p>
          A User's request to delete their personal account does not necessarily authorize deletion
          of records belonging to the Customer Organization or other Users. Because OpenLedgerApp
          preserves an audit trail of posted bookkeeping records, individual records may be voided
          rather than erased; the organization as a whole may be deleted instead.
        </p>
        <p>
          Customer Organizations should maintain their own copies of records they are independently
          required to preserve.
        </p>
      </section>

      <section>
        <h2>13. Privacy Rights and Requests</h2>
        <p>
          Depending on your location, the nature of the information, and applicable law, you may
          have rights concerning Personal Information maintained within the Application. These
          rights may include:
        </p>
        <ul>
          <li>Requesting access to Personal Information.</li>
          <li>Requesting correction of inaccurate information.</li>
          <li>Requesting deletion of Personal Information.</li>
          <li>Requesting information about how Personal Information is processed or disclosed.</li>
          <li>Requesting a copy of certain information in a portable format.</li>
          <li>
            Objecting to or restricting certain processing activities where applicable law provides
            that right.
          </li>
          <li>Withdrawing consent where processing is based on consent.</li>
        </ul>
        <p>These rights may be subject to legal exceptions and limitations.</p>
        <p>
          Where a Customer Organization controls the relevant information, Users may need to direct
          their request to that organization. We will assist the organization as appropriate and as
          required by applicable law.
        </p>
        <p>
          Privacy requests may be submitted to <Mail email={LEGAL_CONFIG.privacyEmail} />.
        </p>
        <p>
          We may request additional information reasonably necessary to verify the identity and
          authority of the person making a request.
        </p>
        <p>We will respond to valid requests within the timeframes required by applicable law.</p>
      </section>

      <section>
        <h2>14. Children's Information</h2>
        <p>OpenLedgerApp is designed primarily for organizational and administrative use.</p>
        <p>
          The Application is not intentionally designed to collect Personal Information directly
          from children under the age of 13.
        </p>
        <p>
          Users and Customer Organizations are responsible for ensuring that information concerning
          minors is collected, submitted, and maintained in accordance with applicable law.
        </p>
        <p>
          Where information concerning a child is submitted without an appropriate legal basis or
          authorization, the affected organization or individual should contact us so that the
          matter can be reviewed and addressed.
        </p>
      </section>

      <section>
        <h2>15. Data Location and Processing</h2>
        <p>
          Information may be processed or stored in the locations where the Operating Organization
          and its authorized service providers maintain infrastructure, which may include the United
          States.
        </p>
        <p>
          The location of data storage and processing may depend on the hosting and infrastructure
          services used by the Application.
        </p>
        <p>
          Where information is transferred across state or national boundaries, we will take
          reasonable steps to comply with applicable legal requirements governing such transfers.
          This Policy does not represent that the Service is offered under, or certified for,
          European Union or United Kingdom data-protection frameworks.
        </p>
      </section>

      <section>
        <h2>16. Security Incidents and Breach Notifications</h2>
        <p>
          If we become aware of a security incident involving information maintained within
          OpenLedgerApp, we will investigate and take reasonable steps to contain, mitigate, and
          address the incident.
        </p>
        <p>
          Where applicable law requires notification of affected individuals, Customer
          Organizations, or regulatory authorities, we will provide such notification in accordance
          with the applicable legal requirements.
        </p>
        <p>
          Where legally permitted and reasonably practicable, we may notify affected Customer
          Organizations to assist with their own legal and operational responsibilities.
        </p>
        <p>
          The timing, content, and recipients of notifications will depend on the nature of the
          incident and applicable law.
        </p>
      </section>

      <section>
        <h2>17. Third-Party Websites and Services</h2>
        <p>The Application may contain links to external websites or services.</p>
        <p>
          Those services operate independently and may maintain their own privacy policies, terms,
          and data-handling practices.
        </p>
        <p>
          We are not responsible for the privacy or security practices of third-party websites and
          services that are not operated or controlled by us.
        </p>
      </section>

      <section>
        <h2>18. Changes to This Privacy Policy</h2>
        <p>
          We may update this Privacy Policy to reflect changes in our practices, the Application, or
          applicable law.
        </p>
        <p>
          The current version will be published within the Application with its effective or
          last-updated date.
        </p>
        <p>
          Where changes materially affect how information is collected, processed, or disclosed, we
          will provide notice or obtain consent where required by applicable law.
        </p>
        <p>We encourage Users and Customer Organizations to review this Policy periodically.</p>
      </section>

      <section>
        <h2>19. Contact and Privacy Inquiries</h2>
        <p>OpenLedgerApp is operated by {op}.</p>
        <ul>
          <li>
            Privacy inquiries and data requests: <Mail email={LEGAL_CONFIG.privacyEmail} />
          </li>
          <li>
            Technical support: <Mail email={LEGAL_CONFIG.supportEmail} />
          </li>
        </ul>
        <p>
          For privacy requests, please include your organization name, relevant account
          information, and a description of your request.
        </p>
        <p>
          We may request additional information to verify your identity or authority before acting
          on a request.
        </p>
      </section>
    </LegalPage>
  );
}
