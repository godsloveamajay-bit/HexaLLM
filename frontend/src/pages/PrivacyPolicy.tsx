import { Link } from 'react-router-dom'
import { Sparkle, ArrowLeft } from 'lucide-react'

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 px-4 py-12">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-10">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-500 to-secondary-500 flex items-center justify-center">
            <Sparkle className="w-5 h-5 text-white fill-white" />
          </div>
          <span className="font-bold text-lg text-gray-100">NebulaX AI</span>
        </div>

        <Link to="/login" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-300 mb-8 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to login
        </Link>

        <h1 className="text-3xl font-bold text-gray-100 mb-2">Privacy Policy</h1>
        <p className="text-sm text-gray-500 mb-10">Last updated: May 2025</p>

        <div className="space-y-8 text-sm leading-relaxed text-gray-400">

          <section>
            <h2 className="text-base font-semibold text-gray-200 mb-3">1. Overview</h2>
            <p>
              NebulaX AI is an open-source, self-hosted AI platform. When you run NebulaX AI on your own
              infrastructure, all data stays on your server. This policy describes what data is collected,
              how it is used, and your rights as a user.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-200 mb-3">2. Data We Collect</h2>
            <ul className="space-y-2 list-disc list-inside">
              <li><span className="text-gray-300 font-medium">Account information</span> — your username and email address, used to identify your account.</li>
              <li><span className="text-gray-300 font-medium">Conversation history</span> — messages you send to and receive from AI models, stored in the database to enable session continuity.</li>
              <li><span className="text-gray-300 font-medium">Uploaded documents</span> — files you add to knowledge bases, stored on the server for retrieval-augmented generation.</li>
              <li><span className="text-gray-300 font-medium">Request logs</span> — endpoint, timestamp, latency, and model used per request, for analytics and debugging.</li>
            </ul>
            <p className="mt-3">
              We do <span className="text-gray-300">not</span> collect payment information, location data, or any
              data through third-party trackers.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-200 mb-3">3. How Your Data Is Used</h2>
            <ul className="space-y-2 list-disc list-inside">
              <li>To provide and improve the AI chat, agent, and knowledge-base features.</li>
              <li>To display analytics to administrators about platform usage.</li>
              <li>To authenticate your account and keep your sessions secure.</li>
            </ul>
            <p className="mt-3">
              Your data is never sold, shared with third parties, or used to train AI models on external
              servers. All inference runs locally via Ollama on the host machine.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-200 mb-3">4. Data Storage and Security</h2>
            <p>
              All data is stored in a SQLite database on the server you or your organisation controls.
              Passwords are hashed with bcrypt and never stored in plain text. API keys are stored
              hashed. Communication between the desktop app and the server uses HTTPS (via Cloudflare Tunnel
              or your own TLS configuration).
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-200 mb-3">5. Data Retention</h2>
            <p>
              Conversation history and uploaded documents are retained until you delete them. Account data
              is retained until you delete your account. Request logs are retained for up to 90 days unless
              the administrator changes this setting.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-200 mb-3">6. Your Rights</h2>
            <p>You have the right to:</p>
            <ul className="space-y-2 list-disc list-inside mt-2">
              <li>Access all data associated with your account.</li>
              <li>Delete your conversations, documents, and account at any time from the Settings page.</li>
              <li>Export your data — contact your platform administrator to request a full export.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-200 mb-3">7. Cookies and Local Storage</h2>
            <p>
              NebulaX AI uses browser local storage to store your authentication token. No third-party
              cookies or tracking pixels are used.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-200 mb-3">8. Children's Privacy</h2>
            <p>
              NebulaX AI is not directed at children under 13. We do not knowingly collect data from
              anyone under 13 years of age.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-200 mb-3">9. Changes to This Policy</h2>
            <p>
              We may update this policy from time to time. The "Last updated" date at the top of this page
              will reflect any changes. Continued use of the platform after changes constitutes acceptance
              of the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-200 mb-3">10. Contact</h2>
            <p>
              Questions about this policy? Contact the platform administrator or open an issue on the{' '}
              <a
                href="https://github.com/godsloveamajay-bit/nebulaxai"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-400 hover:text-primary-300 underline underline-offset-2"
              >
                NebulaX AI GitHub repository
              </a>.
            </p>
          </section>

        </div>
      </div>
    </div>
  )
}
