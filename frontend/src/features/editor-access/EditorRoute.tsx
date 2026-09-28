import { useParams } from "react-router-dom";
import WebsiteEditor from "../../pages/editor/WebsiteEditor";

/** Route identity owns the entire editor session. Changing sites cannot retain
 * the previous site's document, global styles, undo history or async callbacks.
 */
export default function EditorRoute() {
  const { websiteId } = useParams<{ websiteId: string }>();
  return <WebsiteEditor key={websiteId} />;
}
