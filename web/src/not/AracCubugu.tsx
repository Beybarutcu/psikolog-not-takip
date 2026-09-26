import { BlockquoteButton } from '@/components/tiptap-ui/blockquote-button'
import { CodeBlockButton } from '@/components/tiptap-ui/code-block-button'
import { ColorHighlightPopover } from '@/components/tiptap-ui/color-highlight-popover'
import { HeadingDropdownMenu } from '@/components/tiptap-ui/heading-dropdown-menu'
import { LinkPopover } from '@/components/tiptap-ui/link-popover'
import { ListDropdownMenu } from '@/components/tiptap-ui/list-dropdown-menu'
import { MarkButton } from '@/components/tiptap-ui/mark-button'
import { SearchAndReplaceButton } from '@/components/tiptap-ui/search-and-replace'
import { TextAlignButton } from '@/components/tiptap-ui/text-align-button'
import { UndoRedoButton } from '@/components/tiptap-ui/undo-redo-button'
import { Spacer } from '@/components/tiptap-ui-primitive/spacer'
import { Toolbar, ToolbarGroup, ToolbarSeparator } from '@/components/tiptap-ui-primitive/toolbar'

/**
 * Not editörünün araç çubuğu (tasarım E2): şablonun `MainToolbarContent`'i,
 * masaüstü düzeniyle (uygulama en az 1024 px). Kısayolları TipTap'ın kendi
 * tuş haritaları uygular (E5); düğmeler yalnızca aynı komutları çağırır.
 *
 * # Satıra sığmayan gruplar alt satıra iner (`flex-wrap`)
 *
 * Tek satırda çubuk ~740 px. Danışan dosyasındaki not sütunu (1024 px
 * pencerede ~390 px) ve takvimdeki not sayfasının geniş okuma kipi
 * bundan dar. Şablonun kuralı (`toolbar.scss`, `data-variant="fixed"`)
 * taşanı gizli kaydırma çubuğuyla (`overflow-x: auto`) kendi içinde
 * saklıyordu: "Bul ve değiştir" dahil sağdaki düğmeler görünmüyordu. Tek
 * satırlık asgari genişlik de ızgara izlerini (`1fr`) genişletip belgeyi
 * yatay taşırıyordu (son inceleme A). Grup İÇİ kırılmaz (`ToolbarGroup`
 * kendi `flex`'i), gruplar alt satıra iner. `flex-wrap` bir Tailwind
 * yardımcı sınıfı (`@layer utilities`); katmansız `toolbar.scss` masaüstü
 * genişliğinde `flex-wrap` tanımlamaz (yalnızca 480 px altında `nowrap`,
 * uygulama oraya inmez), yani sınıf geçerli olur. Son grup (`ml-auto`)
 * alt satıra inse de sağda kalır: bul paneli (`not-bul-paneli`) de sağda
 * açılır.
 */
export function AracCubugu({ bulAcik, onBulDegistir }: { bulAcik: boolean; onBulDegistir: () => void }) {
  return (
    <Toolbar aria-label="Biçim araçları" className="flex-wrap">
      <ToolbarGroup>
        <UndoRedoButton action="undo" />
        <UndoRedoButton action="redo" />
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup>
        <HeadingDropdownMenu modal={false} levels={[1, 2, 3]} />
        <ListDropdownMenu modal={false} types={['bulletList', 'orderedList', 'taskList']} />
        <BlockquoteButton />
        <CodeBlockButton />
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup>
        <MarkButton type="bold" />
        <MarkButton type="italic" />
        <MarkButton type="underline" />
        <MarkButton type="strike" />
        <MarkButton type="code" />
        <ColorHighlightPopover />
        <LinkPopover />
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup>
        <MarkButton type="superscript" />
        <MarkButton type="subscript" />
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup>
        <TextAlignButton align="left" />
        <TextAlignButton align="center" />
        <TextAlignButton align="right" />
        <TextAlignButton align="justify" />
      </ToolbarGroup>
      <Spacer />
      <ToolbarGroup className="ml-auto">
        <SearchAndReplaceButton
          aria-expanded={bulAcik}
          data-active-state={bulAcik ? 'on' : 'off'}
          onClick={onBulDegistir}
        />
      </ToolbarGroup>
    </Toolbar>
  )
}
