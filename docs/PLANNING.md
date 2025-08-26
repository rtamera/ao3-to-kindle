# PLANNING.md - AO3 to Kindle Service (Gmail OAuth2)

## 🎯 Project Vision

### **Mission Statement**
Create a free, user-friendly web service that enables fanfiction readers to automatically send AO3 stories to their Kindle devices using their own Gmail account, eliminating manual download and attachment steps while maintaining complete user privacy and control.

### **Core Value Propositions**
- **Zero Cost Forever:** No operational costs, infinitely scalable
- **User Privacy:** Users send from their own Gmail, no third-party access to content
- **Mobile-First:** Seamless experience for users browsing AO3 on phones
- **One-Click Sending:** After initial auth, it's just paste URL and send
- **Trust Through Transparency:** Using Google OAuth builds immediate trust

### **Target Audience**
- Primary: Mobile users browsing AO3 who own Kindle devices
- Secondary: Desktop users who want convenient Kindle delivery
- Demographics: Global AO3 community (millions of potential users)

---

## 🏗️ System Architecture

### **High-Level Architecture**
```
┌────────────────────────────────────────────────────┐
│                   User Device                      │
│                 (Mobile/Desktop)                    │
└──────────────────┬─────────────────────────────────┘
                   │
                   ▼
┌────────────────────────────────────────────────────┐
│              Static Website                        │
│            (GitHub Pages - Free)                   │
│                                                    │
│  Components:                                       │
│  - HTML/CSS/JS (Pure, no framework)              │
│  - Google Sign-In SDK                            │
│  - Gmail API Client Library                      │
└────────┬─────────────────────┬─────────────────────┘
         │                     │
         ▼                     ▼
┌──────────────────┐  ┌──────────────────────────────┐
│  Google OAuth2   │  │   Cloudflare Worker          │
│   & Gmail API    │  │    (CORS Proxy)              │
│                  │  │                              │
│  - User Auth     │  │  - Fetches AO3 content      │
│  - Send Emails   │  │  - Bypasses CORS            │
│  - From User's   │  │  - Extracts download links  │
│    Gmail         │  │  - Returns file data        │
└──────────────────┘  └──────────┬───────────────────┘
         │                        │
         │                        ▼
         │            ┌──────────────────────────────┐
         │            │     AO3 Website              │
         │            │  (archiveofourown.org)       │
         │            └──────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────┐
│              User's Gmail Account                 │
│         (Sends email with attachment)             │
└──────────────────┬────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────┐
│           Amazon Kindle Email Service             │
│         (Receives and delivers to device)         │
└──────────────────────────────────────────────────┘
```

### **Data Flow**
1. User authenticates with Google (one-time)
2. User inputs AO3 URL and Kindle email
3. Frontend requests fanfic via Cloudflare Worker proxy
4. Worker fetches AO3 page, extracts download link
5. Worker downloads file and returns to frontend
6. Frontend creates email with attachment via Gmail API
7. Gmail API sends from user's account to Kindle
8. Kindle processes and delivers to device

### **Security Model**
- **Authentication:** Google OAuth2 with minimal scopes
- **Authorization:** Only `gmail.send` scope requested
- **Data Privacy:** No user data stored anywhere
- **Token Storage:** Session-only in browser memory
- **CORS Handling:** Dedicated proxy for AO3 only

---

## 🛠️ Technology Stack

### **Frontend (100% Static)**
| Component | Technology | Justification |
|-----------|------------|---------------|
| **Hosting** | GitHub Pages | Free forever, reliable, easy deployment |
| **Framework** | None (Vanilla JS) | Keeps it simple, no build process |
| **Styling** | Pure CSS | No dependencies, full control |
| **Language** | ES6+ JavaScript | Modern features, wide support |

### **Authentication & Email**
| Component | Technology | Justification |
|-----------|------------|---------------|
| **Auth** | Google OAuth2 | Trusted, familiar, free |
| **Email API** | Gmail API | Free, reliable, user-controlled |
| **SDK** | Google API JavaScript Client | Official, maintained |

### **Backend Services**
| Component | Technology | Justification |
|-----------|------------|---------------|
| **CORS Proxy** | Cloudflare Workers | 100k requests/day free |
| **File Processing** | Browser APIs | No server needed |
| **Storage** | None required | Stateless design |

### **External Dependencies**
```javascript
// Google Sign-In SDK
https://accounts.google.com/gsi/client

// Google API Client Library
https://apis.google.com/js/api.js

// No other dependencies - keeping it minimal
```

---

## 📋 Functional Requirements

### **Core Features (MVP)**

#### **1. Google Authentication**
- One-click Google Sign-In
- Minimal permission scope (gmail.send only)
- Persistent session (remember user)
- Clear sign-out option

#### **2. AO3 URL Processing**
- Accept any valid AO3 work URL
- Validate URL format
- Extract work ID
- Handle series (future enhancement)

#### **3. File Download & Processing**
- Support formats: MOBI, EPUB, AZW3
- Auto-detect best format based on Kindle email
- Handle files up to 25MB (Gmail limit)
- Convert to base64 for email attachment

#### **4. Email Sending**
- Send from user's Gmail
- "Convert" in subject line (triggers Kindle conversion)
- Proper MIME type for attachments
- Include friendly message body

#### **5. User Experience**
- Clear status messages
- Loading indicators
- Error handling with helpful messages
- Success confirmation

### **Non-Functional Requirements**

#### **Performance**
- Page load < 2 seconds
- Send process < 30 seconds
- Responsive on all devices

#### **Reliability**
- Graceful error handling
- Retry logic for network failures
- Fallback instructions if automation fails

#### **Accessibility**
- WCAG 2.1 AA compliance
- Keyboard navigation
- Screen reader support
- High contrast mode

#### **Browser Support**
- Chrome 90+ (primary)
- Safari 14+ (iOS critical)
- Firefox 88+
- Edge 90+

---

## 🔒 Constraints & Limitations

### **Technical Constraints**
| Constraint | Impact | Mitigation |
|------------|--------|------------|
| Gmail 25MB attachment limit | Large fanfics may fail | Show clear error, suggest alternatives |
| 500 emails/day per user | Power users limited | Each user's own limit, not shared |
| OAuth token expiration | Re-auth needed | Automatic refresh handling |
| CORS restrictions | Can't fetch AO3 directly | Cloudflare Worker proxy |
| AO3 rate limiting | Too many requests blocked | Add delays, caching |

### **Google OAuth Requirements**
- **Development Phase:** Up to 100 test users
- **Production Phase:** Requires verification (2-6 weeks)
- **Required Documents:** Privacy Policy, Terms of Service
- **Consent Screen:** Must clearly explain gmail.send scope

### **Legal & Compliance**
- Must not violate AO3 Terms of Service
- Respect copyright (fanfiction gray area)
- GDPR compliance (no data storage helps)
- Clear privacy policy required
- Terms of service required

---

## 🎨 Design Principles

### **UI/UX Philosophy**
1. **Minimal Friction:** Fewest clicks possible
2. **Mobile-First:** Touch-friendly, responsive
3. **Trust Building:** Professional appearance, clear permissions
4. **Progressive Disclosure:** Advanced options hidden initially
5. **Instant Feedback:** User always knows what's happening

### **Visual Design Guidelines**
- **Color Palette:** 
  - Primary: Google Blue (#4285F4)
  - Secondary: Purple gradient (AO3 vibes)
  - Success: Green (#0F9D58)
  - Error: Red (#EA4335)
- **Typography:** System fonts for fast loading
- **Spacing:** Generous touch targets (48px minimum)
- **Animations:** Subtle, purposeful, accessibility-respecting

### **Content Strategy**
- Clear, non-technical language
- Helpful error messages with solutions
- Inline help text where needed
- FAQ section for common issues

---

## 📁 Project Structure

```
ao3-to-kindle/
├── index.html                 # Main application page
├── auth.html                  # OAuth redirect handler
├── privacy.html              # Privacy policy (required)
├── terms.html                # Terms of service (required)
├── css/
│   └── styles.css           # All styles
├── js/
│   ├── app.js              # Main application logic
│   ├── auth.js             # Google OAuth handling
│   ├── gmail.js            # Gmail API integration
│   ├── ao3.js              # AO3 fetching logic
│   └── config.js           # Configuration (CLIENT_ID, etc.)
├── assets/
│   ├── favicon.ico         # Site favicon
│   └── og-image.png        # Social media preview
├── cloudflare/
│   └── worker.js           # Cloudflare Worker code
├── docs/
│   ├── PLANNING.md         # This file
│   ├── TASK.md            # Task tracking
│   └── SETUP.md           # Setup instructions
├── README.md               # User-facing documentation
├── LICENSE                 # MIT License
└── .github/
    └── workflows/
        └── deploy.yml      # GitHub Actions deployment
```

---

## 🚀 Deployment Strategy

### **Phase 1: Development (Week 1)**
- Local development with test credentials
- Use localhost for OAuth redirect
- Test with personal Gmail and Kindle

### **Phase 2: Alpha Testing (Week 2)**
- Deploy to GitHub Pages
- Limited to 100 test users (OAuth test mode)
- Gather feedback, fix bugs

### **Phase 3: Verification (Week 3-6)**
- Submit for Google OAuth verification
- Create required legal documents
- Prepare for scale

### **Phase 4: Production (Week 7+)**
- Full public launch
- Monitor for issues
- Iterate based on feedback

### **Rollback Plan**
- Git tags for each release
- Can revert GitHub Pages instantly
- Cloudflare Worker has separate versioning

---

## 📊 Success Metrics

### **Technical Metrics**
- Page load time < 2 seconds
- Send success rate > 95%
- Zero server costs maintained
- Uptime > 99.9% (GitHub Pages SLA)

### **User Metrics**
- Daily active users
- Conversion rate (visit → sign in)
- Send completion rate
- Return user rate

### **Growth Indicators**
- Organic search traffic
- Social media mentions
- GitHub stars
- User feedback sentiment

---

## 🔮 Future Enhancements (Post-MVP)

### **Near-term (Month 2-3)**
- [ ] Remember Kindle email
- [ ] Batch sending (multiple fics)
- [ ] Series support (entire series)
- [ ] Format auto-detection
- [ ] Dark mode

### **Medium-term (Month 4-6)**
- [ ] Download history
- [ ] Scheduled sending
- [ ] Browser extension version
- [ ] Other fanfic sites
- [ ] PWA capabilities

### **Long-term (6+ months)**
- [ ] Reading lists
- [ ] Social features
- [ ] Recommendations
- [ ] Mobile app (if needed)

---

## ⚠️ Risk Analysis

### **Technical Risks**
| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Google API changes | Low | High | Monitor deprecation notices |
| AO3 blocks proxy | Medium | High | Multiple proxy strategies |
| Gmail API quota | Low | Medium | Per-user limits help |
| Browser compatibility | Low | Low | Progressive enhancement |

### **Business Risks**
| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| OAuth verification denied | Low | High | Follow guidelines carefully |
| AO3 legal concern | Low | High | Clear we're user tool |
| Viral growth crash | Medium | Medium | Scale-ready architecture |
| Copycat services | High | Low | First-mover advantage |

---

## 📚 Resources & Documentation

### **Official Documentation**
- [Google OAuth2 Guide](https://developers.google.com/identity/protocols/oauth2)
- [Gmail API Reference](https://developers.google.com/gmail/api/reference/rest)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [GitHub Pages Guide](https://docs.github.com/en/pages)

### **Key Decisions**
1. **Why Gmail OAuth over Brevo?** Infinite scale, user trust, zero cost
2. **Why no framework?** Simplicity, no build process, fast loading
3. **Why Cloudflare Workers?** Best free tier, good performance
4. **Why GitHub Pages?** Reliable, free, easy deployment

---

## ✅ Definition of Done (MVP)

- [ ] Google OAuth working with gmail.send scope
- [ ] Can fetch and download AO3 fanfics
- [ ] Successfully sends to Kindle via Gmail
- [ ] Works on mobile browsers
- [ ] Privacy policy and terms published
- [ ] Submitted for OAuth verification
- [ ] Documentation complete
- [ ] Zero operational costs confirmed

---

*Last Updated: [Current Date]*
*Version: 1.0.0*
*Status: Planning Phase*