# Minimal Portfolio

A personal publishing site for presenting its owner, their work, and their writing.

## Language

**Portfolio owner**:
The person whose identity, work, and writing the portfolio presents.
_Avoid_: Author, Site owner, User

**Visitor**:
An anonymous person browsing the portfolio.
_Avoid_: User, Reader, Account

**Blog post**:
A dated piece of long-form writing published in the portfolio's blog.
_Avoid_: Article, Post

**Blog view**:
A recorded opening of one Blog post by a visitor; multiple Blog views may belong to the same visitor.
_Avoid_: Unique view, Read

**Project**:
A published portfolio entry describing a body of work and the portfolio owner's role in it.
_Avoid_: Case study, Work item

**Project status**:
A short public label describing a Project's real-world state, such as active, live, or completed. It is not publishing state.
_Avoid_: Publication status, Draft status

**Owner workspace**:
The private area where the Portfolio owner manages and previews portfolio content.
_Avoid_: Admin panel, Editor view, CMS

**Content item**:
A Home page, About page, Project, or Blog post managed as one editable and publishable unit in the Owner workspace.
_Avoid_: Page record, Document

**Content draft**:
A private, editable version of portfolio content that is not visible to Visitors.
_Avoid_: Unpublished change, Work in progress

**Publication**:
The explicit act that turns a valid Content draft into a new immutable Published revision and makes it current for Visitors.
_Avoid_: Save, Deploy, Go live

**Published revision**:
An immutable snapshot created by Publication. A Content item's current Published revision is visible to Visitors; earlier revisions remain its history.
_Avoid_: Live draft, Current copy

**Public route**:
The canonical Visitor-facing path for a published Project or Blog post. Former Public routes stay reserved and redirect to the current one.
_Avoid_: Content ID, URL field

**Publication date**:
The date a Blog post presents to Visitors and uses for ordering. It defaults to first publication but may be backdated before then.
_Avoid_: Created date, Updated date

**Media asset**:
An uploaded image that a Content draft or Published revision may reference. Replacing one creates a different Media asset so older revisions remain complete.
_Avoid_: Image URL, Attachment
